import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { appDocument } from '@/app/appDocument';
import { getDictionary } from '@/i18n/getDictionary';
import { SUPPORTED_LOCALES, isSupportedLocale } from '@/lib/i18n';

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
 * Root layout for the localized app. Every route lives under `/[locale]`, so this segment IS the root layout — the
 * standard Next.js App Router i18n shape. It rejects an unsupported locale and renders the app's document,
 * {@link appDocument}, which also frames the global 404 page (`global-not-found.tsx`); the provider chain, the Clerk URL
 * props and the analytics mount are documented there.
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

    return appDocument({ locale, children });
}
