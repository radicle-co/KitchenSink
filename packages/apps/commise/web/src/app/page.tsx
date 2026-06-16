import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Home | Commise',
    description: 'Your personal AI-powered recipe assistant',
};

export default async function HomePage() {
    const { userId } = await auth();

    if (!userId) {
        // Bare path: Next's server redirect() already applies the configured basePath (prefixing it
        // here would double it to /pr-{N}/pr-{N}/…). Clerk URL props differ — those DO need withBasePath.
        redirect('/sign-in' as Route);
    }

    redirect('/profile');
}
