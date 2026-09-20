/**
 * The pure access policy for the authored-food TEST PURGE (`POST /api/v1/foods/authored/test-purge`) — food's half
 * of ADR-0040's repeatable self-purge.
 *
 * @pattern Specification — the sibling of `authorshipPolicy.ts`: one question ("may this caller use the test
 *   purge?"), answered from the inputs alone, with no DB, no request and no I/O, so the whole rule is a truth
 *   table the suite exhausts.
 *
 * ## ⛔ Every refusal is the same `not-found`, and this policy absorbs the arms that would otherwise leak
 *
 * The door is a fixture, not a product surface, so to anyone it does not admit it must be indistinguishable from
 * a path this service does not route. The controller's ordinary identity helpers cannot be run first: a `svc_*`
 * principal would receive `requireUserUlid`'s `403`, and a user whose `external_id` has not synced would receive
 * `401 IDENTITY_SYNC_PENDING` — both of which confirm the route exists. So the policy reads the three facts those
 * helpers read and folds every one of their refusals into `not-found`, and on admission hands back the ULID it
 * resolved, so the caller never needs a second, leakier helper.
 *
 * ## ⚠️ ONE witness — and recipe-service's door has only one too
 *
 * Recipe-service's purge requires the signed claim AND its own `test_principals` registry, but that registry is
 * written FROM the claim, so it is one witness checked twice rather than two (ADR-0040 §4). Food keeps no registry,
 * so this door has the claim alone. ADR-0040 makes a genuinely independent witness a precondition of any production
 * tenant, for both doors. What bounds the damage of a mis-marked real user is the purge's predicate, not
 * this policy: it reaches only the caller's own PRIVATE authored foods, never a promoted food other cooks may
 * depend on, never a catalog row.
 */
import {
    isServicePrincipalSub,
    resolveRequesterId,
    type AuthenticatedPrincipal,
} from '../../auth/authenticatedPrincipal.js';

/** The facts the decision reads — a projection of the verified principal, nothing else. */
export type TestPurgeAccessInput = Pick<AuthenticatedPrincipal, 'sub' | 'userId' | 'testPrincipal'>;

/** The verdict. `allowed` carries the app-user ULID the purge is keyed on; `not-found` maps to the unrouted 404. */
export type TestPurgeAccessVerdict =
    { readonly kind: 'allowed'; readonly userId: string } | { readonly kind: 'not-found' };

const NOT_FOUND: TestPurgeAccessVerdict = { kind: 'not-found' };

/**
 * Decide whether this caller may purge its own authored foods. Pure and total.
 *
 * Admits exactly one case: the verified claim is `true`, the principal is a person rather than a named service
 * principal, and its app-user ULID has synced. The service-principal and sync rules are `resolveRequesterId`'s,
 * reused rather than restated, so this door cannot drift from what every other authored-food route treats as a
 * user.
 *
 * @param input - The verified principal's `sub`, `userId` and `testPrincipal` claim.
 * @returns `allowed` with the caller's ULID, or the concealing `not-found`.
 */
export function evaluateTestPurgeAccess(input: TestPurgeAccessInput): TestPurgeAccessVerdict {
    if (input.testPrincipal !== true) {
        return NOT_FOUND;
    }

    // Authored rows belong to people: a named service principal owns none, whatever its token claims.
    if (isServicePrincipalSub(input.sub)) {
        return NOT_FOUND;
    }

    const resolution = resolveRequesterId(input);

    if (resolution.status !== 'resolved') {
        return NOT_FOUND;
    }

    return { kind: 'allowed', userId: resolution.requesterId };
}
