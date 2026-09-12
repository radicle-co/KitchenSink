/**
 * Mint a real Clerk session token for a `+clerk_test` profile, from the stage's OWN instance.
 *
 * ## Why a session token, and why THIS way
 *
 * A deployed stage verifies against its own Clerk instance, so a self-signed JWT — however well formed —
 * answers `401` from every service. A test credential has to come from the authority the system under test
 * trusts, or it is testing a different system.
 *
 * ⛔ Clerk's BACKEND API (`POST /sessions` then `POST /sessions/{id}/tokens`) is the obvious shortcut and is
 * REJECTED here: that token carries **no `azp`**, and an `azp`-less token is admitted only by the
 * `client_type: 'native'` gate the mobile app's own JWT template mints. Measured against a live `pr-{N}`
 * stage: `401` from both the recipe and food services.
 *
 * So the sign-in runs against the **Frontend API** with `Origin` set to the stage's web origin, because that
 * Origin is what Clerk stamps as `azp` — which is what `CLERK_AZP_PATTERN` on the deployed services is
 * anchored against (ADR-0033). The resulting token is the same shape a real browser session carries.
 *
 * ⚠️ FAPI sign-in is per-IP rate limited, so this composes {@link establishSession} +
 * {@link remintFromSession} rather than owning the handshake. A caller that needs MANY tokens over a long
 * run must hold the handle and re-mint from it — see `clerkSession.ts` — because calling this repeatedly is
 * repeated SIGN-IN, which is the limited half.
 */
import { establishSession, remintFromSession } from './clerkSession.js';
import type { SessionCredential } from './clerkSession.js';

export { CLERK_TEST_CODE, fapiHostFromPublishableKey } from './clerkSession.js';
export type { SessionCredential } from './clerkSession.js';

/**
 * Sign `email` in against `publishableKey`'s instance and return a session token whose `azp` is `origin`.
 *
 * @sideEffect Performs a Frontend API sign-in (network), creating a Clerk session.
 */
export async function mintSessionToken(input: {
    readonly email: string;
    readonly publishableKey: string;
    readonly origin: string;
}): Promise<SessionCredential> {
    return remintFromSession(await establishSession(input));
}
