/**
 * The locale root layout's composition — the ONE place the whole web app's document shell is assembled.
 *
 * `[locale]/layout.tsx` is the App Router root layout (it owns `<html>`/`<body>`; there is no
 * `app/layout.tsx`), so anything mounted here is mounted on EVERY page. That makes it the correct — and
 * the only — home for a document-level side-effect component such as Vercel Web Analytics, and it makes
 * "exactly once" a property worth asserting rather than assuming: a second `<Analytics />` added lower in
 * the tree would double-count every page view, and one added outside `<body>` would not ship at all.
 *
 * Pattern: the layout is a **Composite** of providers (Clerk → Locale → Recipe) with analytics as a
 * **Null Object** leaf — it renders no DOM, only a document-level effect. The provider ORDER is a
 * contract, not an accident (`RecipeProviders` calls `useAuth`, so it must sit inside `ClerkProvider`;
 * `LocaleProvider` feeds `useMessages` beneath both), so this suite pins the whole chain: an
 * "insert the analytics tag" edit that reshuffles the providers fails here rather than at runtime.
 *
 * The leaf is `<RedactedAnalytics />`, never the vendor's `<Analytics />` directly — the wrapper is what
 * binds the `beforeSend` URL redaction (`src/lib/analyticsRedaction.ts`), so mounting the raw leaf here
 * would ship every page view's full query string. Both facts are asserted below: the wrapper is present
 * AND the raw leaf is absent, so a revert to `<Analytics />` fails here rather than in production traffic.
 *
 * The layout is invoked as the plain async function a Next server component is, and the returned ELEMENT
 * TREE is inspected (the `appShellRoutes` / `dataPagePrefetch` precedent) — no framework runtime, no
 * mounting, and therefore no chance of a real analytics beacon. `@vercel/analytics/next` is mocked
 * regardless, both to keep the network unreachable and so the raw-leaf absence check compares against a
 * known export identity.
 */
import { assert, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';

import { SUPPORTED_LOCALES } from '@/lib/i18n';

vi.mock('@vercel/analytics/next', () => ({ Analytics: vi.fn((): null => null) }));
vi.mock('next/navigation', () => ({
    notFound: vi.fn(() => {
        // Mirrors Next's real `notFound()`: typed `never`, aborts the render by throwing.
        throw new Error('NEXT_NOT_FOUND');
    }),
}));

const { Analytics } = await import('@vercel/analytics/next');
const { ClerkProvider } = await import('@clerk/nextjs');
const { LocaleProvider } = await import('@commise/i18n/react');
const { RedactedAnalytics } = await import('@/components/app/RedactedAnalytics');
const { RecipeProviders } = await import('@/components/recipes/RecipeProviders');
const { default: LocaleLayout, generateStaticParams } = await import('../layout.js');

/** A marker child, so "the layout still renders what it was handed" is assertable by identity. */
const CHILD_TEXT = 'route-content-marker';

/** Render the layout for `locale` and return its root element. */
async function renderLayout(locale: string): Promise<ReactElement> {
    return LocaleLayout({
        children: <span>{CHILD_TEXT}</span>,
        params: Promise.resolve({ locale }),
    });
}

/** EVERY element of the given component type in `node`'s tree, depth-first through `children`. Pure. */
function collectElementsByType(node: ReactNode, type: unknown): readonly ReactElement[] {
    if (Array.isArray(node)) {
        return node.flatMap((child) => collectElementsByType(child as ReactNode, type));
    }

    if (!isValidElement(node)) {
        return [];
    }

    const descendants = collectElementsByType((node.props as { children?: ReactNode }).children, type);

    return node.type === type ? [node, ...descendants] : descendants;
}

/**
 * The chain of element types from `node` down to the FIRST element of `type`, inclusive. Empty when the
 * type is absent. Pure — used to assert nesting order without mounting anything.
 */
function pathToType(node: ReactNode, type: unknown): readonly unknown[] {
    if (Array.isArray(node)) {
        for (const child of node) {
            const path = pathToType(child as ReactNode, type);

            if (path.length > 0) {
                return path;
            }
        }

        return [];
    }

    if (!isValidElement(node)) {
        return [];
    }

    if (node.type === type) {
        return [node.type];
    }

    const rest = pathToType((node.props as { children?: ReactNode }).children, type);

    return rest.length > 0 ? [node.type, ...rest] : [];
}

describe('the locale root layout mounts Vercel Web Analytics', () => {
    it('renders the REDACTING analytics wrapper, never the raw vendor leaf', async () => {
        // The raw leaf reports the full URL, query string included. Only the wrapper binds `beforeSend`.
        const element = await renderLayout('en');

        expect(collectElementsByType(element, RedactedAnalytics)).toHaveLength(1);
        expect(collectElementsByType(element, Analytics)).toHaveLength(0);
    });

    it('renders it exactly once per document, inside <body>', async () => {
        // Two instances double-count every page view; one outside `<body>` never reaches the document.
        const element = await renderLayout('en');
        const path = pathToType(element, RedactedAnalytics);

        expect(path).toContain('body');
        expect(path.filter((type) => type === RedactedAnalytics)).toHaveLength(1);
        expect(collectElementsByType(element, RedactedAnalytics)).toHaveLength(1);
    });

    it('mounts it for EVERY supported locale, not just the default', async () => {
        // The layout is per-locale, and `generateStaticParams` renders one tree per locale — a guard placed
        // behind a locale check would silently leave other locales untracked (or, worse, leave one locale on
        // the unredacted leaf).
        for (const locale of SUPPORTED_LOCALES) {
            const element = await renderLayout(locale);

            expect(
                collectElementsByType(element, RedactedAnalytics),
                `locale ${locale} mounts no redacted Analytics`,
            ).toHaveLength(1);
            expect(collectElementsByType(element, Analytics), `locale ${locale} mounts the RAW leaf`).toHaveLength(0);
        }

        expect(generateStaticParams().map(({ locale }) => locale)).toEqual([...SUPPORTED_LOCALES]);
    });
});

describe('the locale root layout preserves its provider composition', () => {
    it('keeps the provider chain Clerk → document → Locale → Recipe intact', async () => {
        // `RecipeProviders` calls `useAuth`, so it MUST stay inside `ClerkProvider`; `LocaleProvider` feeds
        // `useMessages` beneath both. Adding a document-level leaf must not reshuffle any of that.
        const element = await renderLayout('en');

        expect(pathToType(element, RecipeProviders)).toEqual([
            ClerkProvider,
            'html',
            'body',
            LocaleProvider,
            RecipeProviders,
        ]);
    });

    it('hangs the analytics leaf off <body> directly, NOT inside the provider tree', async () => {
        // Analytics consumes no app context — only Next's router hooks — so it stays a body-level sibling of
        // the provider chain (Vercel's documented placement). Nesting it under a provider would couple a
        // document-level side effect to state it does not use, and would make it route content.
        const element = await renderLayout('en');

        expect(pathToType(element, RedactedAnalytics)).toEqual([ClerkProvider, 'html', 'body', RedactedAnalytics]);
    });

    it('still renders the route content it was handed, beside the analytics leaf', async () => {
        const element = await renderLayout('en');
        const [recipeProviders] = collectElementsByType(element, RecipeProviders);

        expect(recipeProviders).toBeDefined();
        assert(recipeProviders !== undefined);

        const children = (recipeProviders.props as { children?: ReactNode }).children;

        expect(collectElementsByType(children, 'span')).toHaveLength(1);
        expect(collectElementsByType(children, RedactedAnalytics)).toHaveLength(0);
    });

    it('rejects an unsupported locale before rendering anything', async () => {
        await expect(renderLayout('zz')).rejects.toThrow('NEXT_NOT_FOUND');
    });
});
