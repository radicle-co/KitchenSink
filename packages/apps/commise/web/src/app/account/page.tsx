import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { buildApiClient } from '@/lib/api-client';
import type { UserProfile } from '@kitchensink/identity-service';
import { AccountEditForm } from '@/components/auth/AccountEditForm';
import { AccountDeleteForm } from '@/components/auth/AccountDeleteForm';

export const metadata: Metadata = {
    title: 'Account Settings | Commise',
    description: 'Manage your account settings',
};

async function getUserProfile(accessToken: string): Promise<UserProfile> {
    const api = buildApiClient(accessToken);

    return api.get<UserProfile>('/v1/users/me');
}

async function AccountContent({ accessToken, userId }: { accessToken: string; userId: string }) {
    const profile = await getUserProfile(accessToken);

    return (
        <main>
            <h1>Account Settings</h1>
            <section aria-labelledby="edit-heading">
                <h2 id="edit-heading">Edit Profile</h2>
                <AccountEditForm accessToken={accessToken} initialProfile={profile} />
            </section>
            <section aria-labelledby="delete-heading">
                <h2 id="delete-heading">Danger Zone</h2>
                <AccountDeleteForm accessToken={accessToken} userId={userId} />
            </section>
        </main>
    );
}

export default async function AccountPage() {
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect('/sign-in' as Route);
    }

    const token = (await getToken()) ?? '';

    return <AccountContent accessToken={token} userId={userId} />;
}
