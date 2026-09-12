import { resolveMessages } from '@commise/i18n';
import { createProfileServiceClient } from '@/lib/identityServiceClient';
import type { UserProfile } from '@kitchensink/schema-identity';
import { AppShell } from '@/components/app/AppShell';
import { AccountStateGate } from '@/components/auth/AccountStateGate';
import { AccountEditForm } from '@/components/auth/AccountEditForm';
import { AccountCloseForm } from '@/components/auth/AccountCloseForm';
import { AccountEraseForm } from '@/components/auth/AccountEraseForm';
import { authMessages } from '@/components/auth/messages';
import { pageContainer, pageHeading, sectionCard, sectionHeading } from '@/components/auth/authChrome';

/**
 * The `/account` route content + its identity fetch, kept OUT of `page.tsx` so the route segment exports
 * only Next.js-valid fields (a page module may not export arbitrary components — `next build` rejects it),
 * and so the AppShell/state-gate wiring can be unit-tested directly without driving the whole route.
 *
 * U3: the account surface now renders inside the shared {@link AppShell} (nav on desktop AND narrow — the
 * bare, nav-less route was itself a defect) with the design-system card/field idiom, and all copy resolves
 * through {@link authMessages}. The danger-zone controls (close/erase) keep their own shared `ConfirmDialog`
 * flow (CR-002 U4b) — U3 only routes their triggers through the DS `Button` and gives them a card home.
 *
 * **SSR resilience.** The identity read is a server-side fetch, so an unreachable identity service (deploy
 * window, cold start, or simply not booted in the web-e2e job) would otherwise reject inside rendering and
 * throw the WHOLE route into its error boundary — taking the danger zone, which needs no profile at all,
 * down with it. This route therefore degrades the same way `/profile` (and, per B19, the recipe pages) already
 * do: the shell, heading, and danger zone still render, with a status notice standing in for the edit form.
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

export async function AccountContent({
    accessToken,
    locale,
}: {
    accessToken: string;
    locale: string;
}): Promise<React.ReactElement> {
    const { account } = resolveMessages(authMessages, locale);
    let profile: UserProfile | undefined;

    try {
        profile = await getUserProfile(accessToken);
    } catch {
        // Degrade, never crash (see the module doc): `profile` stays undefined and the edit section renders a
        // recoverable status instead. The danger zone below is unaffected — it needs no profile.
        profile = undefined;
    }

    return (
        <AppShell activeId="profile" titleId="account">
            <AccountStateGate>
                <div className={pageContainer}>
                    <h1 className={pageHeading}>{account.title}</h1>
                    <section aria-labelledby="edit-heading" className={sectionCard}>
                        <h2 id="edit-heading" className={sectionHeading}>
                            {account.editHeading}
                        </h2>
                        {profile === undefined ? (
                            <p role="status" className="text-body-md text-slate">
                                {account.loadError}
                            </p>
                        ) : (
                            <AccountEditForm accessToken={accessToken} initialProfile={profile} />
                        )}
                    </section>
                    <section aria-labelledby="danger-heading" className={sectionCard}>
                        <h2 id="danger-heading" className={sectionHeading}>
                            {account.dangerHeading}
                        </h2>
                        {/* Two DISTINCT, non-conflatable actions: recoverable closure vs irreversible erasure. */}
                        <AccountCloseForm accessToken={accessToken} />
                        <AccountEraseForm />
                    </section>
                </div>
            </AccountStateGate>
        </AppShell>
    );
}
