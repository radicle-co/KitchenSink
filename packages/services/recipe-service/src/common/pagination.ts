/**
 * S-R8 — the shared pagination-envelope helper: the ONE `hasMore` formula + shared `page`/`pageSize`
 * clamps, used by every paginated list/search endpoint (`recipes`, `search`, `collections`).
 *
 * Before this module existed, envelope construction was duplicated at three call sites with TWO
 * DIFFERENT `hasMore` formulas: `recipes.service.ts` and `search.service.ts` used the naive
 * `page * pageSize < total`, while `collections.service.ts` used `offset + rows.length < total`. Both
 * formulas AGREE whenever a page is filled to exactly `pageSize` rows (including the exact-last-full-page
 * case) — which is why the drift went unnoticed — but they DIVERGE whenever the actual returned row count
 * is less than `pageSize` for a reason other than "this is the true final page" (e.g. a page whose row
 * count the naive formula simply never inspects). The naive formula silently ASSUMES every page before
 * the last is full; {@link toPageEnvelope} instead trusts the caller's actual `rowCount`, which is
 * unconditionally correct.
 *
 * Callers wrap their own rows under their own key (`data` for recipes/collections, `results` + `facets`
 * for search) — this helper only builds the shared `{ total, page, pageSize, hasMore }` metadata block.
 */

/** Default page size when a caller does not specify one (search's pre-existing default; now shared). */
export const DEFAULT_PAGE_SIZE = 20;

/** Hard ceiling on page size (search's pre-existing ceiling; now shared). */
export const MAX_PAGE_SIZE = 50;

/** Inputs to {@link toPageEnvelope}. */
export interface PageEnvelopeInput {
    /** The unpaged total number of matching rows. */
    readonly total: number;
    /** The 1-based page number this envelope describes. */
    readonly page: number;
    /** The requested page size. */
    readonly pageSize: number;
    /** The ACTUAL number of rows returned for this page (`rows.length` / `results.length`). */
    readonly rowCount: number;
}

/** The pagination metadata shared by every paginated envelope. */
export interface PageEnvelopeMeta {
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly hasMore: boolean;
}

/**
 * Build the shared pagination metadata block for a page of results.
 *
 * `hasMore` is `offset + rowCount < total` (`offset = (page - 1) * pageSize`) — correct on a short final
 * page because it is anchored to the ACTUAL row count returned, not an assumption that every page prior
 * to the last is exactly `pageSize` rows. Pure.
 */
export function toPageEnvelope(input: PageEnvelopeInput): PageEnvelopeMeta {
    const { total, page, pageSize, rowCount } = input;
    const offset = (page - 1) * pageSize;

    return {
        total,
        page,
        pageSize,
        hasMore: offset + rowCount < total,
    };
}

/** Clamp a requested page number to a minimum of 1, defaulting to 1 when absent/invalid. Pure. */
export function clampPage(page: number | undefined): number {
    if (page === undefined || !Number.isFinite(page)) {
        return 1;
    }

    return Math.max(Math.trunc(page), 1);
}

/** Clamp a requested page size into `[1, MAX_PAGE_SIZE]`, defaulting to `DEFAULT_PAGE_SIZE` when absent/invalid. Pure. */
export function clampPageSize(pageSize: number | undefined): number {
    if (pageSize === undefined || !Number.isFinite(pageSize)) {
        return DEFAULT_PAGE_SIZE;
    }

    return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE);
}
