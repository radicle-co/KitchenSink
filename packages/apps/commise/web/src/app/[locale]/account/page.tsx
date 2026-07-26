import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { buildApiClient } from '@/lib/apiClient';
import type { UserProfile } from '@kitchensink/identity-service';
import { AccountStateGate } from '@/components/auth/AccountStateGate';
import { AccountEditForm } from '@/components/auth/AccountEditForm';
import { AccountCloseForm } from '@/components/auth/AccountCloseForm';
import { AccountEraseForm } from '@/components/auth/AccountEraseForm';

export const metadata: Metadata = {
    title: 'Account Settings | Commise',
    description: 'Manage your account settings',
};

async function getUserProfile(accessToken: string): Promise<UserProfile> {
    const api = buildApiClient(accessToken);

    return api.get<UserProfile>('/v1/users/me');
}

async function AccountContent({ accessToken }: { accessToken: string }) {
    const profile = await getUserProfile(accessToken);

    return (
        <AccountStateGate>
            <main>
                <h1>Account Settings</h1>
                <section aria-labelledby="edit-heading">
                    <h2 id="edit-heading">Edit Profile</h2>
                    <AccountEditForm accessToken={accessToken} initialProfile={profile} />
                </section>
                <section aria-labelledby="danger-heading">
                    <h2 id="danger-heading">Danger Zone</h2>
                    {/* Two DISTINCT, non-conflatable actions: recoverable closure vs irreversible erasure. */}
                    <AccountCloseForm accessToken={accessToken} />
                    <AccountEraseForm />
                </section>
            </main>
        </AccountStateGate>
    );
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const token = (await getToken()) ?? '';

    return <AccountContent accessToken={token} />;
}
