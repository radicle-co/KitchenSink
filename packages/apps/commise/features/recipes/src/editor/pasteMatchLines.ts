/**
 * @module @commise/features-recipes/editor — the Adapter from the wire onto the view shape both matching flows draw:
 * the job view's per-food `match` (ADR-0071), plus the paste overlay (`pasteMatchSession`), become the `MatchLine`s the
 * list and pane render. `matchLine.ts` names this module as the one place the wire is mapped; a client never redeclares
 * a wire shape (ADR-0014), so the wire type is the schema package's.
 *
 * The rulings it holds:
 * - ONLY a confident line arrives bound. A `default`, `needsChoice` or `noMatch` line is bound only by the cook's pick in
 *   the overlay (ADR-0070 section 5: defaults serve imports, never the cook), and a `checking` line only by the cook's.
 * - The overlay's binding wins over a late verdict, always (ADR-0071 section 9: "a late verdict never replaces a cook
 *   pick"). When the cook's pick differs from a verdict that reads confident, the line carries a {@link ReviewNote} (the
 *   food the check suggests, and why); a note is recomputed from the wire every time and never trusted from the overlay.
 * - The server's reason folds into three `BoundBy` values: an exact name or a curated mapping is the server's; a
 *   remembered match or a verified review is the review's; an unknown reason is the server's (a newer server's reason
 *   must not read as the review's).
 * - A bound food outside the candidates is NOT added here: `choiceListViewOf` already shows a bound food first
 *   (matchLineView.ts), for a cook's search pick and a server's proposal alike, so a second copy of that rule would
 *   be two authorities.
 * - A food with no match yet is `optionsFailed` when its match request failed, else still `checking`.
 *
 * Only foods that joined the draft are drawn, in paste order.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Adapter — the wire's `match` and the paste overlay onto `MatchLine`
 */
import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import type {
    BoundBy,
    FoodChoice,
    LineBinding,
    LineText,
    MatchLine,
    ReviewNote,
} from '../ingredientMatching/matchLine.js';
import { foodKeyOf } from './matchDemand.js';
import { draftKeyOf, type PasteMatchSession } from './pasteMatchSession.js';

type WireLine = ParseJobResponse['lines'][number];
type WireProposal = NonNullable<WireLine['proposal']>;
type WireFood = WireProposal['foods'][number];
type WireMatch = NonNullable<WireFood['match']>;

/** What the adapter reads. */
export interface PasteMatchLinesInput {
    /** The job as last read. */
    readonly job: ParseJobResponse;
    /** The paste overlay: which foods joined the draft, and who bound them. */
    readonly session: PasteMatchSession;
    /** The foods whose match request failed. Applies only while the food has no match. */
    readonly optionsFailed: ReadonlySet<string>;
    /** The cook-facing words for a server `reason` key (the host's localisation), shown by "See why". */
    readonly reviewReasonOf: (reason: string) => string;
}

/** The reasons whose bound food the REVIEW (or a remembered review) vouched for. */
const REVIEW_REASONS: ReadonlySet<string> = new Set(['rememberedMatch', 'reviewVerified']);

/**
 * Who bound a confident line, from the server's reason. Pure.
 *
 * @param reason - The wire `reason` key.
 * @returns `review` for a remembered or verified match, else `server` (exact name, curated mapping, or unknown).
 */
export function boundByOf(reason: string): Exclude<BoundBy, 'cook'> {
    return REVIEW_REASONS.has(reason) ? 'review' : 'server';
}

/** The line as the cook wrote it: the stated measure when it starts the line, and the words after it. Pure. */
function lineTextOf(proposal: WireProposal): LineText {
    const measure = proposal.statedMeasure?.trim() ?? '';
    const raw = proposal.raw.trim();

    return measure !== '' && raw.toLowerCase().startsWith(measure.toLowerCase())
        ? { measure: raw.slice(0, measure.length), words: raw.slice(measure.length).trim() }
        : { measure: '', words: raw };
}

/** The wire's candidates as the choices a list offers, in the server's order. Pure. */
function choicesOf(match: WireMatch): readonly FoodChoice[] {
    return match.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        isDefault: candidate.isDefault,
    }));
}

/**
 * The binding a line shows: the overlay's when there is one (a cook's carries the note derived from the wire now), else
 * what the server derived for a confident line, else nothing. Pure.
 */
function bindingOf(
    held: LineBinding | undefined,
    match: WireMatch,
    reviewReasonOf: (reason: string) => string,
): LineBinding | undefined {
    if (held === undefined) {
        return match.state === 'confident' && match.proposed !== null
            ? {
                  boundBy: boundByOf(match.reason),
                  pick: { kind: 'food', foodId: match.proposed.id, name: match.proposed.name },
              }
            : undefined;
    }

    if (held.boundBy !== 'cook') {
        return held;
    }

    return { boundBy: 'cook', pick: held.pick, reviewNote: reviewNoteOf(held, match, reviewReasonOf) };
}

/** The note a verdict that finished after the cook's pick leaves: only when it reads confident and names another food. */
function reviewNoteOf(
    held: Extract<LineBinding, { boundBy: 'cook' }>,
    match: WireMatch,
    reviewReasonOf: (reason: string) => string,
): ReviewNote | undefined {
    // The note reads "Our check suggested {food}. Your choice stays.": it belongs to a pick of a FOOD. A line the cook
    // kept as written chose no food, so there is no choice for the suggestion to sit beside (owner design).
    if (held.pick.kind !== 'food') {
        return undefined;
    }

    return match.state === 'confident' && match.proposed !== null && match.proposed.id !== held.pick.foodId
        ? { suggestedFood: match.proposed.name, reason: reviewReasonOf(match.reason) }
        : undefined;
}

/** One food as a line. Pure. */
function lineOf(
    key: string,
    line: LineText,
    food: WireFood,
    held: LineBinding | undefined,
    failed: boolean,
    reviewReasonOf: (reason: string) => string,
): MatchLine {
    const match = food.match;

    if (match == null) {
        return failed
            ? { key, line, state: 'optionsFailed', binding: undefined }
            : { key, line, state: 'checking', proposal: food.name, binding: held };
    }

    const candidates = choicesOf(match);
    const binding = bindingOf(held, match, reviewReasonOf);

    switch (match.state) {
        case 'checking':
            return { key, line, state: 'checking', proposal: match.proposed?.name ?? food.name, binding };

        case 'confident':
            // A confident match that names no food cannot arrive bound: ask the cook, as the server's own fallback does.
            if (binding === undefined) {
                return candidates.length > 0
                    ? { key, line, state: 'needsChoice', candidates, binding: undefined }
                    : { key, line, state: 'noMatch', binding: undefined };
            }

            return { key, line, state: 'confident', candidates, binding };

        case 'default':
            return { key, line, state: 'default', noun: food.name, candidates, binding };

        case 'needsChoice':
            return { key, line, state: 'needsChoice', candidates, binding };

        case 'noMatch':
            return { key, line, state: 'noMatch', binding };
    }
}

/**
 * The paste's matched lines: every food that joined the draft, in paste order, in the state the wire gives it. Pure.
 *
 * @param input - The job, the overlay, the failed requests and the reason words.
 * @returns The lines.
 */
export function pasteMatchLinesOf(input: PasteMatchLinesInput): readonly MatchLine[] {
    const { job, session, optionsFailed, reviewReasonOf } = input;

    return job.lines.flatMap((wireLine) => {
        const { proposal } = wireLine;

        if (proposal === null) {
            return [];
        }

        const text = lineTextOf(proposal);

        return proposal.foods.flatMap((food, foodIndex) => {
            const key = foodKeyOf(wireLine.lineIndex, foodIndex);

            return draftKeyOf(session, key) === undefined
                ? []
                : [lineOf(key, text, food, session.bindings.get(key), optionsFailed.has(key), reviewReasonOf)];
        });
    });
}
