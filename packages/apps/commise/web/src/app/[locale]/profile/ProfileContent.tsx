import { AppShell } from '@/components/app/AppShell';
import { AccountStateGate } from '@/components/auth/AccountStateGate';
import { ProfileSurface } from '@/components/profile/ProfileSurface';

/**
 * The `/profile` route content — the one Profile page (`docs/design/uiOverhaul/buildSpec.md` §9.1) in the shared
 * {@link AppShell}, behind the account-state gate (a suspended or impersonated session sees the notice, not the page).
 * Kept OUT of `page.tsx` so the route segment exports only Next.js-valid fields (a page module may not export arbitrary
 * components — `next build` rejects it).
 *
 * It fetches nothing. The profile is read in the browser by `ProfileSurface` through the same cached query the shell's
 * avatar uses, with a fresh bearer token per call: the server used to read it here and hand a captured token to the
 * client forms, and a Clerk session token lives about a minute, so a cook who read the page for longer than that had
 * every danger-zone call rejected as unauthenticated. The read's loading and failed states are the page's own, which an
 * await in this component could not express.
 *
 * @returns The page.
 */
export function ProfileContent(): React.ReactElement {
    return (
        <AppShell activeId={null} titleId="profile">
            <AccountStateGate>
                <ProfileSurface />
            </AccountStateGate>
        </AppShell>
    );
}
