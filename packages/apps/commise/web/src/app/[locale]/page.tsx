import { auth } from '@clerk/nextjs/server';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { LogoutButton } from '@/components/auth/LogoutButton';
import { getDictionary } from '@/i18n/getDictionary';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { home } = getDictionary(locale);
    const { userId } = await auth();

    if (!userId) {
        // Bare path: Next's server redirect() applies the configured basePath (empty under subdomain
        // serving; /pr-{N} under a legacy path-routed preview). The locale segment is carried explicitly.
        redirect(`/${locale}/sign-in` as Route);
    }

    // Signed-in users land HERE — the post sign-up/in forceRedirectUrl is `/${locale}`, and the home
    // page RENDERS (rather than bouncing to /profile), so a freshly-signed-up user stays on home.
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-background)] px-4 py-12 text-center">
            <h1 className="text-2xl font-semibold">{home.welcome}</h1>
            <p>{home.tagline}</p>
            <nav aria-label={home.nav.label} className="flex gap-4">
                <Link href={`/${locale}/profile` as Route}>{home.nav.profile}</Link>
                <Link href={`/${locale}/settings` as Route}>{home.nav.settings}</Link>
                <Link href={`/${locale}/account` as Route}>{home.nav.account}</Link>
            </nav>
            <LogoutButton />
        </main>
    );
}
