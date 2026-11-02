/**
 * THE NAME PROPOSAL POLICY — which settled answers the editor's add-by-name field OFFERS, and under what source.
 *
 * Owner rulings 2026-11-03 (after devil's advocate M2; ADR-0071 as amended): a typed name never binds a remembered
 * answer by itself. The cook's own earlier correction, a staff ruling, two cooks agreeing, and a memo another cook's save
 * taught each PROPOSE, in the add field's list, under a "Suggested" caption. The cook picks, and the pick binds through
 * the ordinary by-food door.
 *
 * Only the two SETTLED tiers feed it (curated mappings and memos). The ranked tier is deliberately not a source: the
 * field's own list already shows the catalog's hits for the typed text, so a ranked proposal would repeat that request.
 *
 * The source is read from the tier's STRUCTURED `mapping` field and never from its `evidence` prose, which is for a
 * human reading an audit and may be reworded.
 *
 * ⛔ A ONE-WAY DOOR, partly: {@link NameProposalSource} keys are the wire values of the response's `source`. The wire
 * schema keeps them an open string so an installed client survives a new key; this exhaustive union is the server's
 * side of that bargain.
 *
 * DESIGN PATTERN: **Policy** — a pure mapping from what the tiers said to what the cook is shown. No I/O.
 */
import { foodRefKey, type FoodRef } from '../../database/schema/foodLookupArm.js';
import type { TierOutcome } from '../resolution/resolutionCascade.js';

/**
 * Where a proposal came from, strongest first. The order IS the precedence: a person's ruling about this very cook
 * outranks one about everybody, which outranks what a cohort agreed, which outranks what the verification gate agreed.
 */
export const NAME_PROPOSAL_SOURCES = ['ownCorrection', 'staffRuling', 'corroborated', 'remembered'] as const;

/** One of {@link NAME_PROPOSAL_SOURCES}. */
export type NameProposalSource = (typeof NAME_PROPOSAL_SOURCES)[number];

/** A food to offer, and why. Names are not here: food names it at read time, as the caller (ADR-0045). */
export interface NameProposalDraft {
    readonly food: FoodRef;
    readonly source: NameProposalSource;
}

type ResolvedOutcome = Extract<TierOutcome, { readonly kind: 'resolved' }>;

/**
 * The source of a curated answer, or `undefined` when its mapping is missing or not one this policy names.
 * Fails closed: a curated answer that does not say what it is cannot be labelled.
 *
 * @param mapping - The structured facts of the mapping that answered.
 * @returns The source key. Pure.
 */
function curatedSourceOf(mapping: ResolvedOutcome['mapping']): NameProposalSource | undefined {
    if (mapping === undefined) {
        return undefined;
    }

    if (mapping.scope === 'author') {
        return 'ownCorrection';
    }

    if (mapping.origin === 'curator') {
        return 'staffRuling';
    }

    if (mapping.origin === 'corroboration') {
        return 'corroborated';
    }

    return undefined;
}

/**
 * The source of one resolved tier answer, or `undefined` when no source of this route owns that tier.
 *
 * @param outcome - A resolved answer.
 * @returns The source key. Pure.
 */
function sourceOf(outcome: ResolvedOutcome): NameProposalSource | undefined {
    switch (outcome.tier) {
        case 'curated':
            return curatedSourceOf(outcome.mapping);
        case 'memo':
            return 'remembered';
        default:
            return undefined;
    }
}

/**
 * Turn the tiers' answers into the foods to offer: strongest source first, each food once, under its strongest source.
 *
 * @param outcomes - Every tier's answer (`consultEveryTier`), in any order. Passes are ignored.
 * @returns The drafts, in precedence order. Pure.
 */
export function nameProposalDraftsOf(outcomes: readonly TierOutcome[]): readonly NameProposalDraft[] {
    const strongest = new Map<string, NameProposalDraft>();

    for (const outcome of outcomes) {
        if (outcome.kind !== 'resolved') {
            continue;
        }

        const source = sourceOf(outcome);

        if (source === undefined) {
            continue;
        }

        const key = foodRefKey(outcome.food);
        const held = strongest.get(key);

        if (held === undefined || NAME_PROPOSAL_SOURCES.indexOf(source) < NAME_PROPOSAL_SOURCES.indexOf(held.source)) {
            strongest.set(key, { food: outcome.food, source });
        }
    }

    return [...strongest.values()].sort(
        (left, right) => NAME_PROPOSAL_SOURCES.indexOf(left.source) - NAME_PROPOSAL_SOURCES.indexOf(right.source),
    );
}
