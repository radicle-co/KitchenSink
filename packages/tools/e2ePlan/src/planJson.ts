/**
 * The plan as the one JSON document the bin prints and the doors read.
 *
 * A tier is `{ kind: 'all', reasons }` (run the whole tier; there is no list) or `{ kind: 'some', ids }` (run these;
 * an empty list means run none). Both ends use this module, so the two cannot disagree about which is which.
 */
import { z } from 'zod';

import type { GreenStamp } from './greenStamp.js';
import { stampSchema } from './stampStore.js';
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

const tierSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all'), reasons: z.array(z.string()) }),
    z.object({ kind: z.literal('some'), ids: z.array(z.string()) }),
]);

const baseSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ref'), ref: z.string() }),
    z.object({ kind: z.literal('stamp'), tree: z.string(), owed: z.array(z.string()) }),
    z.object({ kind: z.literal('none'), reason: z.string() }),
]);

const planSchema = z.object({
    web: tierSchema,
    mobile: tierSchema,
    warnings: z.array(z.string()),
    base: baseSchema,
    treeAtStart: z.string().nullable(),
    previous: stampSchema.nullable(),
});

/**
 * Reads a serialised plan.
 *
 * @param text - JSON text from {@link toPlanJson}.
 * @returns The plan.
 * @throws When the text is not a plan, naming the field. A reader that guessed would read damage as "run nothing".
 */
export function parsePlanJson(text: string): PlanJson {
    const parsed = planSchema.safeParse(JSON.parse(text));

    if (!parsed.success) {
        throw new Error(`error: the plan is not a plan (${parsed.error.message})`);
    }

    return parsed.data;
}

/**
 * A tier as lines a shell can read: `all`, or `some` followed by one id per line.
 *
 * @param tier - The tier.
 * @returns The text.
 */
export const tierLines = (tier: TierJson): string =>
    tier.kind === 'all' ? 'all\n' : `some\n${tier.ids.map((id) => `${id}\n`).join('')}`;
