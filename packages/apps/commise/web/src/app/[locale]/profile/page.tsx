import type { Route } from 'next';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { buildApiClient } from '@/lib/apiClient';
import type { UserProfile } from '@kitchensink/identity-service';
import { AccountStateGate } from '@/components/auth/AccountStateGate';
import { LogoutButton } from '@/components/auth/LogoutButton';

export const metadata: Metadata = {
    title: 'Profile | Commise',
    description: 'Your user profile',
};

async function getUserProfile(accessToken: string): Promise<UserProfile> {
    const api = buildApiClient(accessToken);

    return api.get<UserProfile>('/v1/users/me');
}

export async function ProfileContent({ accessToken }: { accessToken: string }) {
    let profile: UserProfile;

    try {
        profile = await getUserProfile(accessToken);
    } catch {
        // The identity service being briefly unreachable (deploy window, cold start, or simply not booted in
        // the web-e2e job) must not crash this server-rendered page with an unhandled fetch rejection. Degrade
        // to a recoverable state instead — the client-side `useUserProfile` hook re-fetches and fills it in.
        return (
            <AccountStateGate>
                <main>
                    <h1>Profile</h1>
                    <p role="status">We couldn’t load your profile right now. Please try again shortly.</p>
                    <LogoutButton />
                </main>
            </AccountStateGate>
        );
    }

    return (
        <AccountStateGate>
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
        </AccountStateGate>
    );
}

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId, getToken } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    const token = (await getToken()) ?? '';

    return <ProfileContent accessToken={token} />;
}
