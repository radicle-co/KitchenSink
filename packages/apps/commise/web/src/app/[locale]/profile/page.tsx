import type { Metadata } from 'next';

import { requireSignedIn } from '@/lib/requireSignedIn';
import { getDictionary } from '@/i18n/getDictionary';

import { ProfileContent } from './ProfileContent';

/** The tab's title and the shared link's description, in the request's locale. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { title, description } = getDictionary(locale).pageMetadata.profile;

    return { title, description };
}

// L9: like every AppShell-hosted route, the authenticated nav shell's Clerk-backed hooks require a live
// session, so this route is per-request dynamic, not statically prerenderable. Matches the recipes routes.
export const dynamic = 'force-dynamic';

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    await requireSignedIn(locale, `/${locale}/profile`);

    return <ProfileContent />;
}
