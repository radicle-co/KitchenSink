import { resolveMessages } from '@commise/i18n';
import { buildApiClient } from '@/lib/apiClient';
import type { UserProfile } from '@kitchensink/identity-service';
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
 */
async function getUserProfile(accessToken: string): Promise<UserProfile> {
    const api = buildApiClient(accessToken);

    return api.get<UserProfile>('/v1/users/me');
}

export async function AccountContent({
    accessToken,
    locale,
}: {
    accessToken: string;
    locale: string;
}): Promise<React.ReactElement> {
    const profile = await getUserProfile(accessToken);
    const { account } = resolveMessages(authMessages, locale);

    return (
        <AppShell activeId="profile">
            <AccountStateGate>
                <div className={pageContainer}>
                    <h1 className={pageHeading}>{account.title}</h1>
                    <section aria-labelledby="edit-heading" className={sectionCard}>
                        <h2 id="edit-heading" className={sectionHeading}>
                            {account.editHeading}
                        </h2>
                        <AccountEditForm accessToken={accessToken} initialProfile={profile} />
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
