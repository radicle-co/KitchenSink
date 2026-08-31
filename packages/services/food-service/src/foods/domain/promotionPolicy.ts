/**
 * The pure PROMOTION-CANDIDACY rule (plan U12; Q5 / D8) — when cross-author agreement on a private
 * authored food TRIGGERS a moderation-queue entry, and which contributing food is elected canonical
 * when a human approves it.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of {@link ../authorshipPolicy.ts} and
 * recipe-service's `correctionScopePolicy` — no DB, no `Principal`, no I/O; the service reads the facts
 * and passes them in, and the same inputs always produce the same decision.
 *
 * ## ⛔ Corroboration is the TRIGGER, never the PUBLISHER (owner ruling 2026-08-30)
 *
 * Nothing this module decides makes a food world-readable. A `trigger: true` decision creates a PENDING
 * queue row that an operator reviews (`foodsAdmin.controller.ts`); only the approve route publishes.
 * Two throwaway accounts can therefore trigger a queue entry — and NOTHING more. The gates below
 * (author tenure, the rejection fingerprint) exist to keep the QUEUE itself un-griefable, not to make
 * the trigger a security boundary; the human approval is the boundary.
 *
 * ## The author-tenure gate is a PROXY, stated as such
 *
 * The plan asks for "accounts older than a minimum age". Account age is IDENTITY-service data, and this
 * service deliberately holds no cross-service read for it (the same boundary ADR-0006 draws for
 * databases). The proxy is the author's FIRST APPEARANCE in this service's own store — the `created_at`
 * of their earliest authored food — which the caller passes as `authorFirstSeenAt`. A brand-new sock
 * account fails it identically; an old account that never authored a food starts its tenure at first
 * authorship, which errs toward triggering LATER (the safe direction for a moderated queue).
 *
 * ## Compatibility is measured around the MEDIAN, so one outlier cannot block two honest authors
 *
 * A whole-set spread rule would let anyone freeze a name's candidacy forever by writing one garbage food
 * under it. Instead: the per-macro MEDIAN profile is computed over the eligible candidates, candidates
 * beyond {@link PROMOTION_MACRO_TOLERANCE} of the median on ANY macro are excluded, and the kept set
 * must still corroborate ({@link PROMOTION_MIN_AUTHORS} distinct authors). The kept set's internal
 * spread is then within tolerance of the median by construction on every macro.
 */
import { createHash } from 'node:crypto';

/** Distinct authors required to trigger a candidacy. Q2-style calibration constant — provisional. */
export const PROMOTION_MIN_AUTHORS = 2;

/**
 * Relative distance from the per-macro MEDIAN a contributing food may sit at. Q2-style calibration —
 * provisional 10% per the plan.
 */
export const PROMOTION_MACRO_TOLERANCE = 0.1;

/**
 * Minimum author tenure (days since the author's first authored food) to corroborate. Q2-style
 * calibration constant — provisional. See the module docstring for why this is a proxy for account age.
 */
export const PROMOTION_MIN_AUTHOR_TENURE_DAYS = 14;

/** The four Q3a macros, per 100g — the compatibility surface. */
export interface PromotionMacros {
    readonly calories: number;
    readonly proteinG: number;
    readonly carbsG: number;
    readonly fatG: number;
}

/** One private authored food under the shared normalized name. */
export interface PromotionCandidateFood {
    readonly foodId: string;
    readonly userId: string;
    /** When THIS food was written — the election key. ISO 8601. */
    readonly createdAt: string;
    /** When its author FIRST appeared in this service (earliest authored food). ISO 8601. */
    readonly authorFirstSeenAt: string;
    readonly macros: PromotionMacros;
}

/** The complete input to a candidacy decision. */
export interface PromotionCandidacyInput {
    /** Every live PRIVATE authored food sharing the normalized name. */
    readonly candidates: readonly PromotionCandidateFood[];
    /** The evaluation instant (ISO 8601) — passed in, never read from a clock, so the rule stays pure. */
    readonly now: string;
    /** Fingerprints of REJECTED candidacies for this name — the resubmission bar. */
    readonly rejectedFingerprints: readonly string[];
    /**
     * Whether the name is already spoken for: a PENDING or APPROVED queue row exists, or a promoted or
     * catalog food already holds the normalized name. The caller reads this; the policy only honours it.
     */
    readonly nameAlreadyClaimed: boolean;
}

/** The outcome — a discriminated union, so the trigger arm has no optional fields to mis-default. */
export type PromotionCandidacyDecision =
    | { readonly trigger: false; readonly reason: string }
    | {
          readonly trigger: true;
          /** The compatible contributing foods, ordered by id — what the queue row records. */
          readonly contributingFoodIds: readonly string[];
          /** The candidacy's data identity — see {@link promotionFingerprint}. */
          readonly fingerprint: string;
      };

const MACRO_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The median of a non-empty list. Pure. */
function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    const upper = sorted[mid] ?? 0;

    if (sorted.length % 2 === 1) {
        return upper;
    }

    return ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/** Whether `value` sits within tolerance of `reference` — zero agrees only with zero. Pure. */
function withinTolerance(value: number, reference: number): boolean {
    if (reference === 0) {
        return value === 0;
    }

    return Math.abs(value - reference) / Math.abs(reference) <= PROMOTION_MACRO_TOLERANCE;
}

/** Whether the SET's per-macro spread `(max - min) / max` is within tolerance — zero-max needs all-zero. Pure. */
function spreadWithinTolerance(candidates: readonly PromotionCandidateFood[]): boolean {
    return MACRO_KEYS.every((key) => {
        const values = candidates.map((row) => row.macros[key]);
        const max = Math.max(...values);
        const min = Math.min(...values);

        if (max === 0) {
            return min === 0;
        }

        return (max - min) / max <= PROMOTION_MACRO_TOLERANCE;
    });
}

/**
 * The candidacy's DATA IDENTITY: the sorted contributing food ids with each food's macro 4-tuple,
 * hashed. Two candidacies over the same foods with the same macros are THE SAME candidacy — which is
 * exactly what the rejection bar needs: a new corroborating author changes the id set, a macro edit
 * changes the tuple, and either re-opens the door; plain resubmission does not.
 *
 * @param candidates - The contributing foods.
 * @returns A hex SHA-256. Pure.
 */
export function promotionFingerprint(candidates: readonly PromotionCandidateFood[]): string {
    const rows = [...candidates]
        .sort((left, right) => left.foodId.localeCompare(right.foodId))
        .map((row) => [row.foodId, ...MACRO_KEYS.map((key) => String(row.macros[key]))].join(':'));

    return createHash('sha256').update(rows.join('|')).digest('hex');
}

/**
 * Decide whether the private foods under one normalized name trigger a promotion candidacy.
 *
 * @param input - The candidates, the instant, the rejection history, and whether the name is claimed.
 * @returns The decision. Pure.
 */
export function evaluatePromotionCandidacy(input: PromotionCandidacyInput): PromotionCandidacyDecision {
    if (input.nameAlreadyClaimed) {
        return { trigger: false, reason: 'The name is already pending, approved, or held by a public food.' };
    }

    const nowMs = Date.parse(input.now);
    const tenured = input.candidates.filter(
        (row) => nowMs - Date.parse(row.authorFirstSeenAt) >= PROMOTION_MIN_AUTHOR_TENURE_DAYS * DAY_MS,
    );

    // Median profile over the TENURED set, then keep only candidates near it — one outlier cannot veto.
    // The kept set must ALSO agree pairwise: with two candidates the median splits their difference, so a
    // 20% pairwise spread would sit 9% from the median on each side and read as "compatible" without the
    // whole-set spread check. Farthest-from-median candidates are shed until the set agrees or corroboration
    // is lost — deterministic, and one garbage food still cannot veto two honest authors.
    const profile: PromotionMacros = {
        calories: median(tenured.map((row) => row.macros.calories)),
        proteinG: median(tenured.map((row) => row.macros.proteinG)),
        carbsG: median(tenured.map((row) => row.macros.carbsG)),
        fatG: median(tenured.map((row) => row.macros.fatG)),
    };
    let compatible = tenured.filter((row) => MACRO_KEYS.every((key) => withinTolerance(row.macros[key], profile[key])));

    while (compatible.length > 0 && !spreadWithinTolerance(compatible)) {
        const distances = compatible.map((row) => ({
            row,
            distance: Math.max(
                ...MACRO_KEYS.map((key) => {
                    const reference = profile[key];

                    if (reference === 0) {
                        return row.macros[key] === 0 ? 0 : Number.POSITIVE_INFINITY;
                    }

                    return Math.abs(row.macros[key] - reference) / Math.abs(reference);
                }),
            ),
        }));
        const farthest = [...distances].sort(
            (left, right) => right.distance - left.distance || right.row.foodId.localeCompare(left.row.foodId),
        )[0];

        compatible = compatible.filter((entry) => entry !== farthest?.row);
    }

    const distinctAuthors = new Set(compatible.map((row) => row.userId));

    if (distinctAuthors.size < PROMOTION_MIN_AUTHORS) {
        return {
            trigger: false,
            reason: 'Fewer than the required distinct, tenured, macro-compatible authors agree.',
        };
    }

    const fingerprint = promotionFingerprint(compatible);

    if (input.rejectedFingerprints.includes(fingerprint)) {
        return { trigger: false, reason: 'A rejected candidacy over exactly this data may not resubmit.' };
    }

    return {
        trigger: true,
        contributingFoodIds: compatible.map((row) => row.foodId).sort((left, right) => left.localeCompare(right)),
        fingerprint,
    };
}

/**
 * Elect the canonical survivor: the OLDEST contributing food, tiebroken by id. Deterministic, so two
 * operators approving the same candidacy from two terminals elect the same food.
 *
 * @param candidates - The contributing foods (non-empty).
 * @returns The elected `foodId`. Pure.
 * @throws When the set is empty — election over nothing is a caller bug, never a default.
 */
export function electCanonical(
    candidates: ReadonlyArray<Pick<PromotionCandidateFood, 'foodId' | 'createdAt'>>,
): string {
    const winner = [...candidates].sort((left, right) => {
        const byAge = Date.parse(left.createdAt) - Date.parse(right.createdAt);

        if (byAge !== 0) {
            return byAge;
        }

        return left.foodId.localeCompare(right.foodId);
    })[0];

    if (winner === undefined) {
        throw new Error('electCanonical requires at least one candidate.');
    }

    return winner.foodId;
}
