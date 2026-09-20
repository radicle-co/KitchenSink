import { resolveMessages } from '@commise/i18n';
import { createProfileServiceClient } from '@/lib/identityServiceClient';
import type { UserProfile } from '@kitchensink/schema-identity';
import { AppShell } from '@/components/app/AppShell';
import { AccountStateGate } from '@/components/auth/AccountStateGate';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { authMessages } from '@/components/auth/messages';
import {
    detailList,
    detailTerm,
    detailValue,
    pageContainer,
    pageHeading,
    sectionCard,
    sectionHeading,
} from '@/components/auth/authChrome';

/**
 * Profile server component + its identity fetch, kept OUT of `page.tsx` so the route segment exports only
 * Next.js-valid fields (a page module may not export arbitrary components — `next build` rejects it). This
 * split also lets the SSR-resilience behavior be unit-tested directly without rendering the whole route.
 *
 * U3: the profile surface now renders inside the shared {@link AppShell} (nav on desktop AND narrow) with the
 * design-system card idiom, and all copy resolves through {@link authMessages}.
 */
/**
 * Read the signed-in viewer's identity profile through the TYPED client.
 *
 * ⚠️ It went through `buildApiClient(...).get<UserProfile>(...)` until this change, and that generic was the
 * whole problem: `apiClient` ended in `JSON.parse(text) as T`, so naming `UserProfile` here asserted the shape
 * and checked nothing (`docs/CODING_STANDARDS.md` §15 / ADR-0014). `ProfileServiceClient.getMe()` parses the
 * body against `@kitchensink/schema-identity`'s `userProfileSchema` — the same definition the identity service
 * validates with — so a drifted response fails at the boundary instead of rendering a profile card with
 * `undefined` fields.
 *
 * Migrating these two server components is also what let `lib/apiClient.ts` be DELETED. It was the third
 * hand-rolled transport to one service, and its own header called these "the two server-rendered pages that
 * have not migrated to the typed client"; the base origin, the `credentials: 'include'` policy and the
 * circuit-broken 401 redirect all already lived in `createProfileServiceClient`, so `apiClient` duplicated
 * every one of them with no validation.
 *
 * @param accessToken - The server-resolved Clerk access token.
 * @returns The VALIDATED viewer profile.
 * @sideEffect Performs an authenticated HTTP request to the identity service.
 */
async function getUserProfile(accessToken: string): Promise<UserProfile> {
    return createProfileServiceClient(accessToken).getMe();
}

export async function ProfileContent({
    accessToken,
    locale,
}: {
    accessToken: string;
    locale: string;
}): Promise<React.ReactElement> {
    const { profile: copy } = resolveMessages(authMessages, locale);
    let profile: UserProfile;

    try {
        profile = await getUserProfile(accessToken);
    } catch {
        // The identity service being briefly unreachable (deploy window, cold start, or simply not booted in
        // the web-e2e job) must not crash this server-rendered page with an unhandled fetch rejection. Degrade
        // to a recoverable state instead — the client-side `useUserProfile` hook re-fetches and fills it in.
        return (
            <AppShell activeId="profile" titleId="profile">
                <AccountStateGate>
                    <div className={pageContainer}>
                        <h1 className={pageHeading}>{copy.title}</h1>
                        <p role="status" className="text-body-md text-slate">
                            {copy.loadError}
                        </p>
                        <div className="flex justify-start">
                            <LogoutButton />
                        </div>
                    </div>
                </AccountStateGate>
            </AppShell>
        );
    }

    return (
        <AppShell activeId="profile" titleId="profile">
            <AccountStateGate>
                <div className={pageContainer}>
                    <h1 className={pageHeading}>{copy.title}</h1>
                    <section aria-labelledby="profile-heading" className={sectionCard}>
                        <h2 id="profile-heading" className={sectionHeading}>
                            {copy.infoHeading}
                        </h2>
                        <dl className={detailList}>
                            <dt className={detailTerm}>{copy.displayNameLabel}</dt>
                            <dd className={detailValue}>{profile.user.displayName}</dd>
                            <dt className={detailTerm}>{copy.emailLabel}</dt>
                            <dd className={detailValue}>{profile.user.email}</dd>
                            <dt className={detailTerm}>{copy.statusLabel}</dt>
                            <dd className={detailValue}>{profile.user.status}</dd>
                        </dl>
                    </section>
                    <section aria-labelledby="account-heading" className={sectionCard}>
                        <h2 id="account-heading" className={sectionHeading}>
                            {copy.accountHeading}
                        </h2>
                        <dl className={detailList}>
                            <dt className={detailTerm}>{copy.subscriptionTierLabel}</dt>
                            <dd className={detailValue}>{profile.account.subscriptionTier}</dd>
                        </dl>
                    </section>
                    <div className="flex justify-start">
                        <LogoutButton />
                    </div>
                </div>
            </AccountStateGate>
        </AppShell>
    );
}
