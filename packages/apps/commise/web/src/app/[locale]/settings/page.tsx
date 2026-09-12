import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getDictionary } from '@/i18n/getDictionary';

import { SettingsContent } from './SettingsContent';

/** The tab's title and the shared link's description, in the request's locale. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { title, description } = getDictionary(locale).pageMetadata.settings;

    return { title, description };
}

// L9: like every AppShell-hosted route, the authenticated nav shell's Clerk-backed hooks require a live
// session, so this route is per-request dynamic, not statically prerenderable. Matches the recipes routes.
export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return <SettingsContent locale={locale} />;
}
