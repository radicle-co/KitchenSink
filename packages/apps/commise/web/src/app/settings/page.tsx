import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { LogoutButton } from '@/components/auth/LogoutButton';

export const metadata: Metadata = {
    title: 'Settings | Commise',
    description: 'Account security and settings',
};

export default async function SettingsPage() {
    const { userId } = await auth();

    if (!userId) {
        redirect('/sign-in' as Route);
    }

    return (
        <main>
            <h1>Settings</h1>
            <section aria-labelledby="session-heading">
                <h2 id="session-heading">Session</h2>
                <LogoutButton />
            </section>
        </main>
    );
}
