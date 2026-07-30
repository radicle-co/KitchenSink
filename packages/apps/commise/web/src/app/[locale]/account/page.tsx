import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { AccountContent } from './AccountContent';

export const metadata: Metadata = {
    title: 'Account Settings | Commise',
    description: 'Manage your account settings',
};

// L9: like every AppShell-hosted route, this renders the authenticated nav shell (whose Clerk-backed hooks
// require a live session) and reads the caller's own token via `auth()` — so it is per-request dynamic, not
// statically prerenderable. Matches the recipes routes' convention.
export const dynamic = 'force-dynamic';

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const token = (await getToken()) ?? '';

    return <AccountContent accessToken={token} locale={locale} />;
}
