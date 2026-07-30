import { ClerkProvider } from '@clerk/nextjs';
import { LocaleProvider } from '@commise/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { RedactedAnalytics } from '@/components/app/RedactedAnalytics';
import { RecipeProviders } from '@/components/recipes/RecipeProviders';
import { getDictionary } from '@/i18n/getDictionary';
import { withBasePath } from '@/lib/basePath';
import { SUPPORTED_LOCALES, isSupportedLocale } from '@/lib/i18n';

import '../globals.css';

/** Statically render every supported locale's tree. */
export function generateStaticParams(): { locale: string }[] {
    return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { home } = getDictionary(locale);

    return { title: home.title, description: home.tagline };
}

/**
 * Root layout for the localized app. Every route lives under `/[locale]`, so this segment IS the root
 * layout (it owns `<html>`/`<body>`) — the standard Next.js App Router i18n shape. `<html lang>` is the
 * request locale; the {@link LocaleProvider} hands that locale to client components (`useMessages`), while
 * server components resolve copy via {@link getDictionary}. Clerk URL props are locale-aware.
 *
 * Two classes of Clerk URL prop behave differently under a preview basePath (ADR-0001 / U2), and both
 * now also carry the locale segment:
 *  - LOCATOR / raw-navigation props (sign-in/up page location; the post-sign-OUT target Clerk
 *    hard-navigates) are consumed as-is → they carry the basePath via `withBasePath`.
 *  - post-sign-in/up REDIRECT props go through Next's router (which already prepends basePath) → a BARE
 *    path (locale-prefixed, no basePath).
 * `withBasePath` is a no-op under subdomain serving (empty basePath) and prepends `/pr-{N}` under the
 * legacy path-routed preview.
 *
 * {@link RedactedAnalytics} (Vercel Web Analytics via `@vercel/analytics/next` — the App Router entry
 * point) is the one document-level side-effect leaf. It is mounted HERE, and only here, because this layout
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
 * Do NOT "simplify" it by putting `beforeSend` on an `<Analytics />` in this file — this is a server
 * component, so React cannot serialize the function prop and every request 500s (`Functions cannot be
 * passed directly to Client Components`). `next build` stays GREEN on that mistake, because these routes
 * bail out of prerendering, so nothing but a request reveals it. Consent gating remains unwired — that is a
 * separate owner decision.
 */
export default async function LocaleLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;

    if (!isSupportedLocale(locale)) {
        notFound();
    }

    return (
        <ClerkProvider
            signInUrl={withBasePath(`/${locale}/sign-in`)}
            signUpUrl={withBasePath(`/${locale}/sign-up`)}
            signInFallbackRedirectUrl={`/${locale}`}
            signUpFallbackRedirectUrl={`/${locale}`}
            afterSignOutUrl={withBasePath(`/${locale}`)}
        >
            <html lang={locale}>
                <body>
                    <LocaleProvider locale={locale}>
                        <RecipeProviders>{children}</RecipeProviders>
                    </LocaleProvider>
                    <RedactedAnalytics />
                </body>
            </html>
        </ClerkProvider>
    );
}
