import type { Metadata } from 'next';

import { requireSignedIn } from '@/lib/requireSignedIn';
import { getDictionary } from '@/i18n/getDictionary';

import { SourcesContent } from './SourcesContent';

/** The tab's title and the shared link's description, in the request's locale. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { title, description } = getDictionary(locale).pageMetadata.dataSources;

    return { title, description };
}

// Like every AppShell-hosted route, the shell's Clerk-backed hooks need a live session, so the route is per-request
// dynamic. The food endpoint answers 401 without a session too.
export const dynamic = 'force-dynamic';

export default async function DataSourcesRoute({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    await requireSignedIn(locale, `/${locale}/legal/sources`);

    return <SourcesContent />;
}
