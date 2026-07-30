/**
 * Async-producer provenance guard (T-053, FR-048, CR-002/U1). The `fetch_queue` carries NO per-row
 * `requested_by` column — requesters live one-row-per-`(food_id, requester_id)` in `fetch_requesters`
 * (FR-014/FR-044). Before the consumer drains a leased row it MUST validate that every recorded
 * requester is a real, authenticated principal (an app-user **ULID** or an allowlisted named service
 * principal) and that at least one exists, so no unauthenticated producer (a row inserted by an
 * unnamed/unauthorized principal, or one carrying the forbidden `'system'` shortcut) can drive
 * external source consumption. The least-privilege IAM half of T-053 (only named roles may
 * `events:PutEvents` / insert) is infrastructure (CDK) and lives outside this module.
 *
 * **CR-002/U1 rekey.** A user requester is now the app-user ULID (identity's `users.id`, from the
 * token's `external_id`), NOT the Clerk `sub`. The validator is correspondingly tightened: a raw
 * Clerk `sub` (`user_*`) is a legacy pre-U1 key and is REFUSED — it is neither a ULID nor `svc_*`.
 * The cutover that keeps this from stranding in-flight leased foods (legacy `sub`-keyed rows → zero
 * valid requesters → refused) is the `0002_fetch_requesters_rekey.sql` purge — see that migration.
 *
 * @implements FR-048 R5
 */
import { isValid as isValidUlid } from 'ulidx';

/** The forbidden unauthenticated shortcut — provenance must name a real principal, never this. */
const SYSTEM_SHORTCUT = 'system';

/** Allowlisted named service principals (M2M / internal jobs) that may drive a fetch (FR-047). */
const SERVICE_PRINCIPAL_PREFIX = 'svc_';

/**
 * Whether a recorded requester id is a real, authenticated principal (FR-048, CR-002/U1). Pure. A
 * valid app-user **ULID** (a user principal, keyed off the token's `external_id`) or an allowlisted
 * `svc_*` service principal is valid; a raw Clerk `sub` (`user_*`, the legacy pre-U1 key), the
 * `'system'` shortcut (any case), a bare `svc_`, and empty/whitespace are not.
 *
 * @param requesterId - The recorded requester id (an app ULID or `svc_*`).
 * @returns `true` when `requesterId` is a real principal the consumer may act on behalf of.
 */
export function isValidPrincipal(requesterId: string): boolean {
    const trimmed = requesterId.trim();

    if (trimmed.length === 0) {
        return false;
    }

    if (trimmed.toLowerCase() === SYSTEM_SHORTCUT) {
        return false;
    }

    // A named service principal is explicitly allowlisted (a non-empty name after the prefix).
    if (trimmed.startsWith(SERVICE_PRINCIPAL_PREFIX)) {
        return trimmed.length > SERVICE_PRINCIPAL_PREFIX.length;
    }

    // Otherwise the ONLY valid user principal is the app-user ULID (U1) — a raw Clerk `sub` fails here.
    return isValidUlid(trimmed);
}

/**
 * Whether a leased food's recorded requester set proves valid producer provenance (FR-048): there is
 * at least one requester AND every requester is a real principal. Pure.
 *
 * @param requesterIds - The `fetch_requesters` requester ids recorded for the food.
 * @returns `true` when the consumer may drain the row, `false` to refuse it.
 */
export function hasValidProvenance(requesterIds: readonly string[]): boolean {
    return requesterIds.length > 0 && requesterIds.every(isValidPrincipal);
}
