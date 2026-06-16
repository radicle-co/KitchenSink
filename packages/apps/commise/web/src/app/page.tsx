import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';

import { withBasePath } from '@/lib/base-path';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Home | Commise',
    description: 'Your personal AI-powered recipe assistant',
};

export default async function HomePage() {
    const { userId } = await auth();

    if (!userId) {
        // redirect() does NOT apply Next's basePath, so prefix it ourselves (no-op in production).
        redirect(withBasePath('/sign-in') as Route);
    }

    redirect(withBasePath('/profile') as Route);
}
