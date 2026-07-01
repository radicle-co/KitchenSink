/**
 * Async-producer provenance guard (T-053, FR-048). The `fetch_queue` carries NO per-row
 * `requested_by` column — requesters live one-row-per-`(food_id, sub)` in `fetch_requesters`
 * (FR-014/FR-044). Before the consumer drains a leased row it MUST validate that every recorded
 * requester is a real, authenticated principal (a verified user `sub` or an allowlisted named
 * service principal) and that at least one exists, so no unauthenticated producer (a row inserted
 * by an unnamed/unauthorized principal, or one carrying the forbidden `'system'` shortcut) can drive
 * external source consumption. The least-privilege IAM half of T-053 (only named roles may
 * `events:PutEvents` / insert) is infrastructure (CDK) and lives outside this module.
 *
 * @implements FR-048
 */

/** The forbidden unauthenticated shortcut — provenance must name a real principal, never this. */
const SYSTEM_SHORTCUT = 'system';

/** Allowlisted named service principals (M2M / internal jobs) that may drive a fetch (FR-047). */
const SERVICE_PRINCIPAL_PREFIX = 'svc_';

/**
 * Whether a recorded requester `sub` is a real, authenticated principal (FR-048). Pure. A non-empty
 * verified user `sub` or an allowlisted `svc_*` service principal is valid; the `'system'` shortcut
 * (any case) and empty/whitespace are not.
 *
 * @param sub - The recorded requester sub.
 * @returns `true` when `sub` is a real principal the consumer may act on behalf of.
 */
export function isValidPrincipal(sub: string): boolean {
    const trimmed = sub.trim();

    if (trimmed.length === 0) {
        return false;
    }

    if (trimmed.toLowerCase() === SYSTEM_SHORTCUT) {
        return false;
    }

    // A named service principal is explicitly allowlisted; any other non-empty value is a user sub.
    if (trimmed.startsWith(SERVICE_PRINCIPAL_PREFIX)) {
        return trimmed.length > SERVICE_PRINCIPAL_PREFIX.length;
    }

    return true;
}

/**
 * Whether a leased food's recorded requester set proves valid producer provenance (FR-048): there is
 * at least one requester AND every requester is a real principal. Pure.
 *
 * @param subs - The `fetch_requesters` subs recorded for the food.
 * @returns `true` when the consumer may drain the row, `false` to refuse it.
 */
export function hasValidProvenance(subs: readonly string[]): boolean {
    return subs.length > 0 && subs.every(isValidPrincipal);
}
