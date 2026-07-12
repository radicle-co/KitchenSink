import type { Route } from 'next';
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { LogoutButton } from '@/components/auth/LogoutButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Home | Commise',
    description: 'Your personal AI-powered recipe assistant',
};

export default async function HomePage() {
    const { userId } = await auth();

    if (!userId) {
        // Bare path: Next's server redirect() already applies the configured basePath (prefixing it
        // here would double it to /pr-{N}/pr-{N}/…). Unauthenticated visitors go to sign-in.
        redirect('/sign-in' as Route);
    }

    // Signed-in users land HERE — the post sign-up/in forceRedirectUrl is `/`, and the home page now
    // RENDERS instead of bouncing on to /profile, so a freshly-signed-up user stays on the root page.
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-background)] px-4 py-12 text-center">
            <h1 className="text-2xl font-semibold">Welcome to Commise</h1>
            <p>Your personal AI-powered recipe assistant.</p>
            <nav aria-label="Account" className="flex gap-4">
                <Link href="/profile">Profile</Link>
                <Link href="/settings">Settings</Link>
                <Link href="/account">Account</Link>
            </nav>
            <LogoutButton />
        </main>
    );
}
