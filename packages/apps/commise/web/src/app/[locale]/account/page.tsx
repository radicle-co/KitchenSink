import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getDictionary } from '@/i18n/getDictionary';

import { AccountContent } from './AccountContent';

/** The tab's title and the shared link's description, in the request's locale. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { title, description } = getDictionary(locale).pageMetadata.account;

    return { title, description };
}

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
