import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { ProfileContent } from './ProfileContent';

export const metadata: Metadata = {
    title: 'Profile | Commise',
    description: 'Your user profile',
};

// L9: like every AppShell-hosted route, the authenticated nav shell's Clerk-backed hooks require a live
// session, so this route is per-request dynamic, not statically prerenderable. Matches the recipes routes.
export const dynamic = 'force-dynamic';

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const token = (await getToken()) ?? '';

    return <ProfileContent accessToken={token} locale={locale} />;
}
