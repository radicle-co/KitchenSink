import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { SettingsContent } from './SettingsContent';

export const metadata: Metadata = {
    title: 'Settings | Commise',
    description: 'Account security and settings',
};

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
