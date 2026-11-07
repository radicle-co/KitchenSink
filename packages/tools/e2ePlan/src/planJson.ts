/**
 * The plan as the one JSON document the bin prints and the doors read.
 *
 * A tier is `{ kind: 'all', reasons }` (run the whole tier; there is no list) or `{ kind: 'some', ids }` (run these;
 * an empty list means run none). Both ends use this module, so the two cannot disagree about which is which.
 */
import type { Plan, TierSelection } from './selection.js';

export type TierJson =
    | { readonly kind: 'all'; readonly reasons: readonly string[] }
    | { readonly kind: 'some'; readonly ids: readonly string[] };

export interface PlanJson {
    readonly web: TierJson;
    readonly mobile: TierJson;
    readonly warnings: readonly string[];
}

const tierToJson = (selection: TierSelection): TierJson =>
    selection.kind === 'all'
        ? { kind: 'all', reasons: selection.reasons }
        : { kind: 'some', ids: selection.picks.map((pick) => pick.id) };

/**
 * Serialises a plan.
 *
 * @param plan - The plan.
 * @returns JSON text.
 */
export const toPlanJson = (plan: Plan): string =>
    JSON.stringify({ web: tierToJson(plan.web), mobile: tierToJson(plan.mobile), warnings: plan.warnings }, null, 2);

const isStrings = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};

function parseTier(value: unknown, name: string): TierJson {
    const tier = asRecord(value);

    if (tier['kind'] === 'all' && isStrings(tier['reasons'])) {
        return { kind: 'all', reasons: tier['reasons'] };
    }

    if (tier['kind'] === 'some' && isStrings(tier['ids'])) {
        return { kind: 'some', ids: tier['ids'] };
    }

    throw new Error(`error: the plan's ${name} tier is neither all-with-reasons nor some-with-ids`);
}

/**
 * Reads a serialised plan.
 *
 * @param text - JSON text from {@link toPlanJson}.
 * @returns The plan.
 * @throws When the text is not a plan. A reader that guessed would read damage as "run nothing".
 */
export function parsePlanJson(text: string): PlanJson {
    const parsed = asRecord(JSON.parse(text));
    const warnings = parsed['warnings'];

    if (!isStrings(warnings)) {
        throw new Error('error: the plan has no list of warnings');
    }

    return { web: parseTier(parsed['web'], 'web'), mobile: parseTier(parsed['mobile'], 'mobile'), warnings };
}
