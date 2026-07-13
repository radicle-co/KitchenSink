import { ClerkProvider } from '@clerk/nextjs';
import { LocaleProvider } from '@commise/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

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
                </body>
            </html>
        </ClerkProvider>
    );
}
