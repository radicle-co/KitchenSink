/**
 * The plan as the one JSON document the bin prints and the doors read.
 *
 * A tier is `{ kind: 'all', reasons }` (run the whole tier; there is no list) or `{ kind: 'some', ids }` (run these;
 * an empty list means run none). Both ends use this module, so the two cannot disagree about which is which.
 */
import type { GreenStamp } from './greenStamp.js';
import { readStampValue } from './stampStore.js';
import type { Plan, TierSelection } from './selection.js';

export type TierJson =
    | { readonly kind: 'all'; readonly reasons: readonly string[] }
    | { readonly kind: 'some'; readonly ids: readonly string[] };

/** What the change was measured from, as the doors need to see it. */
export type BaseJson =
    | { readonly kind: 'ref'; readonly ref: string }
    | { readonly kind: 'stamp'; readonly tree: string; readonly owed: readonly string[] }
    | { readonly kind: 'none'; readonly reason: string };

/** What a plan says about how it was made. */
export interface PlanMeta {
    readonly base: BaseJson;
    /** The tree of the working tree when the plan was made, which a stamp names. Null when no tree was measured. */
    readonly treeAtStart: string | null;
    /** The stamp the run started from, which a finished run replaces and nothing else. */
    readonly previous: GreenStamp | null;
}

export interface PlanJson extends PlanMeta {
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
 * @param meta - How the plan was measured.
 * @returns JSON text.
 */
export const toPlanJson = (plan: Plan, meta: PlanMeta): string =>
    JSON.stringify(
        { web: tierToJson(plan.web), mobile: tierToJson(plan.mobile), warnings: plan.warnings, ...meta },
        null,
        2,
    );

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

function failPrevious(): never {
    throw new Error('error: the plan has a stamp it cannot read');
}

function parseBase(value: unknown): BaseJson {
    const base = asRecord(value);

    if (base['kind'] === 'ref' && typeof base['ref'] === 'string') {
        return { kind: 'ref', ref: base['ref'] };
    }

    if (base['kind'] === 'stamp' && typeof base['tree'] === 'string' && isStrings(base['owed'])) {
        return { kind: 'stamp', tree: base['tree'], owed: base['owed'] };
    }

    if (base['kind'] === 'none' && typeof base['reason'] === 'string') {
        return { kind: 'none', reason: base['reason'] };
    }

    throw new Error('error: the plan has no base it was measured from');
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

    const tree = parsed['treeAtStart'];

    if (tree !== null && typeof tree !== 'string') {
        throw new Error('error: the plan has no tree it was measured at');
    }

    return {
        web: parseTier(parsed['web'], 'web'),
        mobile: parseTier(parsed['mobile'], 'mobile'),
        warnings,
        base: parseBase(parsed['base']),
        treeAtStart: tree,
        previous: parsed['previous'] === null ? null : (readStampValue(parsed['previous']) ?? failPrevious()),
    };
}

/**
 * A tier as lines a shell can read: `all`, or `some` followed by one id per line.
 *
 * @param tier - The tier.
 * @returns The text.
 */
export const tierLines = (tier: TierJson): string =>
    tier.kind === 'all' ? 'all\n' : `some\n${tier.ids.map((id) => `${id}\n`).join('')}`;
