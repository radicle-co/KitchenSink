import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { buildApiClient } from '@/lib/api-client';
import type { UserProfile } from '@kitchensink/identity-service';
import { LogoutButton } from '@/components/auth/LogoutButton';

export const metadata: Metadata = {
    title: 'Profile | Commise',
    description: 'Your user profile',
};

async function getUserProfile(accessToken: string): Promise<UserProfile> {
    const api = buildApiClient(accessToken);

    return api.get<UserProfile>('/v1/users/me');
}

async function ProfileContent({ accessToken }: { accessToken: string }) {
    const profile = await getUserProfile(accessToken);

    return (
        <main>
            <h1>Profile</h1>
            <section aria-labelledby="profile-heading">
                <h2 id="profile-heading">Your Information</h2>
                <dl>
                    <dt>Display Name</dt>
                    <dd>{profile.user.displayName}</dd>
                    <dt>Email</dt>
                    <dd>{profile.user.email}</dd>
                    <dt>Status</dt>
                    <dd>{profile.user.status}</dd>
                </dl>
            </section>
            <section aria-labelledby="account-heading">
                <h2 id="account-heading">Account</h2>
                <dl>
                    <dt>Subscription Tier</dt>
                    <dd>{profile.account.subscriptionTier}</dd>
                </dl>
            </section>
            <LogoutButton />
        </main>
    );
}

export default async function ProfilePage() {
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect('/sign-in' as Route);
    }

    const token = (await getToken()) ?? '';

    return <ProfileContent accessToken={token} />;
}
