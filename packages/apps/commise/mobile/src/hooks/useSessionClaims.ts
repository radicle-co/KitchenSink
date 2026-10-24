/**
 * `useSessionClaims` — the signed Clerk session claims of the signed-in viewer, as the mobile app sees them.
 *
 * The recipe-detail screen reads the viewer's app-user id off the `external_id` claim FIRST (the same claim the web page
 * reads, and the recipe service's owner key), so the body can show without waiting for the profile read. This is the
 * adapter over `@clerk/expo`, kept in its own file so a screen test can stand in for the session with one `vi.mock`.
 */
import { useAuth } from '@clerk/expo';

/**
 * @returns Clerk's session claims (untyped: `external_id` is a custom claim), or `undefined`/`null` while signed out or
 *     before Clerk has loaded.
 */
export function useSessionClaims(): unknown {
    return useAuth().sessionClaims;
}
