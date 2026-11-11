/**
 * The import view's `version`: a digest of what the view was built from, VERDICTS INCLUDED (ADR-0072 §2).
 *
 * DESIGN PATTERN: **Value digest**, pure. Nothing stores it and nothing bumps it. The review gate writes its verdict by key,
 * from the worker, so a counter recipe-service bumps could never see one land; the digest is computed from the facts at read
 * time and the client compares it with the last one it saw. A fact the view shows that is not in here would be a stale screen
 * the client cannot detect, so every one of them is, and `importViewVersion.test.ts` moves each in turn.
 *
 * The digest is taken over a FIXED-ORDER TUPLE, not over an object, so it does not depend on key order (jsonb reorders keys, a
 * spread reorders them again) and needs no canonical-JSON library. It covers the WHOLE import's facts, not only the page that
 * was asked for, except `items` and `nextAfter`, which are the page.
 *
 * ⛔ The header's activity clock (`updated_at`) is NOT in it. The view does not show it, and every `advance` moves it (it is
 * ADR-0072 §9's purge clock), so it would change the version on every advance that changed nothing the cook can see.
 */

/** One item of the page, as the digest reads it. */
interface VersionItem {
    readonly ordinal: number;
    readonly title: string;
    readonly stage: string;
    readonly review: string;
    readonly statement: { readonly kind: string; readonly citation?: string } | null;
    readonly visibility: string | null;
    readonly recipeId: string | null;
    readonly issue: { readonly reason: string } | null;
}

/** Everything the digest reads. */
export interface ImportVersionFacts {
    readonly header: {
        readonly id: string;
        readonly matchMode: string;
        readonly visibility: string;
        readonly cursorOrdinal: number | null;
        readonly reviewClosed: boolean;
        readonly expectedTotal: number;
    };
    readonly counts: {
        readonly total: number;
        readonly received: number;
        readonly parsing: number;
        readonly matched: number;
        readonly saved: number;
    };
    readonly allowance: { readonly limit: number; readonly used: number; readonly resetsAt: string | null };
    readonly pause: { readonly reason: string } | null;
    readonly items: readonly VersionItem[];
    readonly nextAfter: number | null;
    /** The verdicts on record for the import's lines: how many, and when the latest landed. */
    readonly verdicts: { readonly count: number; readonly latest: string | null };
}

/**
 * The version of a view.
 *
 * @param facts - What the view was built from.
 * @param sha256Hex - The hash, injected so the domain imports no crypto.
 * @returns `v1:` and 64 hex characters. Pure.
 */
export function importViewVersionOf(facts: ImportVersionFacts, sha256Hex: (text: string) => string): string {
    const { header, counts, allowance, pause, verdicts } = facts;
    const tuple = [
        header.id,
        header.matchMode,
        header.visibility,
        header.cursorOrdinal,
        header.reviewClosed,
        header.expectedTotal,
        [counts.total, counts.received, counts.parsing, counts.matched, counts.saved],
        [allowance.limit, allowance.used, allowance.resetsAt],
        pause === null ? null : pause.reason,
        facts.items.map((item) => [
            item.ordinal,
            item.title,
            item.stage,
            item.review,
            item.statement === null ? null : [item.statement.kind, item.statement.citation ?? null],
            item.visibility,
            item.recipeId,
            item.issue === null ? null : item.issue.reason,
        ]),
        facts.nextAfter,
        [verdicts.count, verdicts.latest],
    ];

    return `v1:${sha256Hex(JSON.stringify(tuple))}`;
}
