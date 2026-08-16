/**
 * THE canonicalization of the `?ids=` list for `GET /api/v1/foods/nutrition` (plan U8).
 *
 * ## Why this is its own module, and why it is not "just parsing"
 *
 * The URL **is** the cache key. ADR-0020 keys food's CloudFront distribution on the URL alone — which is
 * only sound because this response is caller-independent — so two callers asking for the same set of foods
 * must produce byte-identical URLs or the cache simply never hits. Order and duplicates are therefore not
 * cosmetic: `?ids=b,a` and `?ids=a,b` requesting the same data through different cache entries is the
 * difference between a CDN and an expensive proxy.
 *
 * ## Why GET, against this codebase's own `POST /foods/batch` precedent
 *
 * **CloudFront does not cache POST responses at all.** Following the local precedent here would have
 * silently voided the entire rationale for putting a distribution in front of food. The departure is
 * deliberate and is recorded in ADR-0020.
 *
 * @module
 */

/**
 * The most ids one request may name.
 *
 * A cap is required, not defensive: without one an unauthenticated-shaped URL can name unbounded ids and
 * turn one request into an unbounded database read — the memory-exhaustion vector the findings review
 * flagged. It also bounds the URL, which CloudFront and the ALB both limit independently.
 */
export const MAX_NUTRITION_IDS = 100;

/** Raised when the caller's id list cannot produce a stable cache key. */
export class NutritionIdListError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'NutritionIdListError';
        Object.setPrototypeOf(this, NutritionIdListError.prototype);
    }
}

/** Type guard for {@link NutritionIdListError}. */
export function isNutritionIdListError(error: unknown): error is NutritionIdListError {
    return error instanceof NutritionIdListError;
}

/**
 * Parse and canonicalize the raw `ids` query value. Pure.
 *
 * Canonical means: split on commas, trimmed, empties dropped, **deduplicated**, **sorted**. The last two are
 * what make the URL a stable cache key regardless of how a client happened to order its request.
 *
 * @param raw - The raw `ids` query parameter.
 * @returns The canonical id list.
 * @throws {NutritionIdListError} When the list is empty or exceeds {@link MAX_NUTRITION_IDS}.
 */
export function canonicalizeNutritionIds(raw: string | undefined): string[] {
    const ids = (raw ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

    if (ids.length === 0) {
        throw new NutritionIdListError('ids must name at least one food id');
    }

    const unique = [...new Set(ids)].sort();

    if (unique.length > MAX_NUTRITION_IDS) {
        throw new NutritionIdListError(
            `ids names ${unique.length} distinct foods, which exceeds the ${MAX_NUTRITION_IDS} per-request cap`,
        );
    }

    return unique;
}

/**
 * The canonical query string for a set of ids — the exact cache key a client should request. Pure.
 *
 * Exported so a CLIENT can build the same URL the server considers canonical, rather than reimplementing
 * the ordering rule and drifting from it.
 *
 * @param ids - The ids to request.
 * @returns The canonical `ids=…` query-string fragment.
 * @throws {NutritionIdListError} Under the same conditions as {@link canonicalizeNutritionIds}.
 */
export function canonicalNutritionQuery(ids: readonly string[]): string {
    return `ids=${canonicalizeNutritionIds(ids.join(',')).join(',')}`;
}
