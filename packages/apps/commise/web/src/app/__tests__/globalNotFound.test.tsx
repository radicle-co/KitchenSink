/**
 * `global-not-found.tsx` — the page Next serves for every URL no route matches. It renders outside every layout, so it
 * must build the app's document itself; if it rendered the not-found surface bare, the page would have no providers
 * (no Clerk, no locale, no styles) and no `<html>`. These tests pin that it renders the SAME document as the root layout,
 * in the default locale, with the not-found surface as its page, and that its title is the localized not-found title.
 *
 * Like `[locale]/__tests__/layout.test.tsx`, the page is called as the plain function a Next server component is and
 * its returned element tree is inspected: no framework runtime and no mounting.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';

vi.mock('@vercel/analytics/next', () => ({ Analytics: vi.fn((): null => null) }));

const { Analytics } = await import('@vercel/analytics/next');
const { ClerkProvider } = await import('@clerk/nextjs');
const { LocaleProvider } = await import('@commise/i18n/react');
const { NotFoundSurface } = await import('@/components/app/NotFoundSurface');
const { RedactedAnalytics } = await import('@/components/app/RedactedAnalytics');
const { RecipeProviders } = await import('@/components/recipes/RecipeProviders');
const { getDictionary } = await import('@/i18n/getDictionary');
const { DEFAULT_LOCALE } = await import('@/lib/i18n');
const { default: GlobalNotFound, metadata } = await import('../global-not-found.js');

/** EVERY element of the given type in `node`'s tree, depth-first through `children`. Pure. */
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

/** The chain of element types from `node` down to the first element of `type`, inclusive; empty when absent. Pure. */
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

describe('global-not-found.tsx', () => {
    it('puts the not-found surface inside the app’s full provider chain', () => {
        expect(pathToType(GlobalNotFound(), NotFoundSurface)).toEqual([
            ClerkProvider,
            'html',
            'body',
            LocaleProvider,
            RecipeProviders,
            NotFoundSurface,
        ]);
    });

    it('renders the document in the default locale', () => {
        const element = GlobalNotFound();
        const [html] = collectElementsByType(element, 'html');
        const [localeProvider] = collectElementsByType(element, LocaleProvider);

        expect(html?.props).toMatchObject({ lang: DEFAULT_LOCALE });
        expect(localeProvider?.props).toMatchObject({ locale: DEFAULT_LOCALE });
    });

    it('mounts the redacting analytics leaf exactly once, never the raw vendor leaf', () => {
        const element = GlobalNotFound();

        expect(collectElementsByType(element, RedactedAnalytics)).toHaveLength(1);
        expect(collectElementsByType(element, Analytics)).toHaveLength(0);
    });

    it('is titled with the localized not-found title', () => {
        expect(metadata.title).toBe(getDictionary(DEFAULT_LOCALE).boundary.notFound.title);
    });
});
