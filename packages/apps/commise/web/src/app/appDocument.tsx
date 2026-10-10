import { ClerkProvider } from '@clerk/nextjs';
import { LocaleProvider } from '@commise/i18n/react';
import { CLERK_CSS_LAYER } from '@commise/ui/clerk';
import type { ReactElement, ReactNode } from 'react';

import { RedactedAnalytics } from '@/components/app/RedactedAnalytics';
import { SidebarPreferenceProvider } from '@/components/home/chrome/sidebarPreferenceContext';
import { RecipeProviders } from '@/components/recipes/RecipeProviders';
import { withBasePath } from '@/lib/basePath';
import { clerkLocalizationFor } from '@/lib/clerkLocalization';
import type { Locale } from '@/lib/i18n';

import './globals.css';

/** What {@link appDocument} needs: the document's locale and the page to put in it. */
export interface AppDocumentProps {
    readonly locale: Locale;
    readonly children: ReactNode;
    /** The sidebar's collapse preference, read from its cookie by the server (`sidebarPreference.ts`). */
    readonly sidebarCollapsed?: boolean;
}

/**
 * The app's document — `<html>`/`<body>` and the provider chain every page renders inside. Two files render it:
 * `[locale]/layout.tsx`, the root layout of every route, and `global-not-found.tsx`, which Next serves for an unknown
 * URL without any layout. One function, so the 404 page cannot drift from the app's document. It returns the element
 * tree rather than being a component, so `[locale]/__tests__/layout.test.tsx` still inspects the real tree without
 * rendering it.
 *
 * `<html lang>` is the locale; the {@link LocaleProvider} hands it to client components (`useMessages`), while server
 * components resolve copy via `getDictionary`. Clerk URL props are locale-aware.
 *
 * Two classes of Clerk URL prop behave differently under a preview basePath (ADR-0001 / U2), and both
 * also carry the locale segment:
 *  - LOCATOR / raw-navigation props (sign-in/up page location; the post-sign-OUT target Clerk
 *    hard-navigates) are consumed as-is → they carry the basePath via `withBasePath`.
 *  - post-sign-in/up REDIRECT props go through Next's router (which already prepends basePath) → a BARE
 *    path (locale-prefixed, no basePath).
 * `withBasePath` is a no-op under subdomain serving (empty basePath) and prepends `/pr-{N}` under the
 * legacy path-routed preview.
 *
 * {@link RedactedAnalytics} (Vercel Web Analytics via `@vercel/analytics/next` — the App Router entry
 * point) is the one document-level side-effect leaf. It is mounted HERE, and only here, because this function
 * owns `<html>`/`<body>`: one instance per document means one page view per navigation. It is a **Null
 * Object** render-wise (returns `null`, adds no DOM, no landmark, no focusable node) and consumes no app
 * context — only Next's router hooks, already wrapped in the package's own `<Suspense>` — so it hangs off
 * `<body>` beside the provider chain rather than inside it. Off Vercel it is inert-by-omission rather than
 * inert-by-design: `next build`/SSR never reach it (`inject` bails when there is no `window`), but in the
 * browser it always appends its script tag, which resolves to nothing outside a Vercel deployment (dev
 * mode fetches Vercel's debug script; a self-hosted production build 404s on
 * `/_vercel/insights/script.js` and logs one console line).
 *
 * The mount is the WRAPPER, not the vendor leaf, because `beforeSend` URL redaction
 * (`src/lib/analyticsRedaction.ts`) is mandatory here: an unredacted page view reports the full query
 * string, and `/[locale]/discover` carries the visitor's free-text search term plus their dietary flags.
 * Do NOT "simplify" it by putting `beforeSend` on an `<Analytics />` in this file — this is server
 * code, so React cannot serialize the function prop and every request 500s (`Functions cannot be
 * passed directly to Client Components`). `next build` stays GREEN on that mistake, because these routes
 * bail out of prerendering, so nothing but a request reveals it. Consent gating remains unwired — that is a
 * separate owner decision.
 *
 * @pattern Composite — the provider chain (Clerk → document → Locale → Recipe), with analytics as a Null Object leaf.
 *
 * Pure.
 */
export function appDocument({ locale, children, sidebarCollapsed = false }: AppDocumentProps): ReactElement {
    return (
        <ClerkProvider
            signInUrl={withBasePath(`/${locale}/sign-in`)}
            signUpUrl={withBasePath(`/${locale}/sign-up`)}
            signInFallbackRedirectUrl={`/${locale}`}
            signUpFallbackRedirectUrl={`/${locale}`}
            afterSignOutUrl={withBasePath(`/${locale}`)}
            // The brand line and the sign-up link's words: Clerk takes localization on its provider.
            localization={clerkLocalizationFor(locale)}
            // Clerk's own styles go in this layer, which `globals.css` ranks below `utilities`, so the role classes on
            // its elements win. A GLOBAL option: Clerk reads it here, not from a form's own `appearance`.
            appearance={{ cssLayerName: CLERK_CSS_LAYER }}
        >
            <html lang={locale}>
                <body>
                    <LocaleProvider locale={locale}>
                        <SidebarPreferenceProvider collapsed={sidebarCollapsed}>
                            <RecipeProviders>{children}</RecipeProviders>
                        </SidebarPreferenceProvider>
                    </LocaleProvider>
                    <RedactedAnalytics />
                </body>
            </html>
        </ClerkProvider>
    );
}
