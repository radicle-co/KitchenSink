/**
 * @module @commise/features-recipes/form — what the editor's ingredient-matching leaves are told about each pasted line
 * once it is parsed (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25).
 *
 * ⛔ These are VIEW shapes, named for what they render, not the server's wire. The server will derive a line's
 * `matchState` (`checking | confident | default | needsChoice | noMatch`), its `candidates[]` and its `reviewNote`; that
 * contract is not merged, and a client never redeclares a wire shape (ADR-0014). The wiring phase maps the wire onto
 * these through an Adapter, which is where `confident` becomes `matched`, a line bound by the cook becomes `chosen`, and
 * `default` / `needsChoice` / `noMatch` become an {@link OpenLine}. A `checking` line resolves into one of those.
 *
 * Each shape carries only what its state can say, so some illegal states cannot be written: a review note on a line the
 * cook did not pick, or a held pick on a line with no options. The types do NOT prove a held `chosenId` is one of the
 * line's `options`; the wiring phase's Adapter owes that check (and a test that fails without it).
 */
import type { DraftKeep } from '../editor/saveStatus.js';

/** A pasted line as the cook wrote it: its leading measure, drawn bold, and the words after it. */
export interface PastedLineText {
    /** The amount and unit the line starts with ("2 cups"), or `''` when it states none ("eggs"). */
    readonly measure: string;
    /** The rest of the line ("milk"). */
    readonly words: string;
}

/** One food a line could be. The server orders them, at most five, the default first; nothing marks a selection. */
export interface FoodChoice {
    /** The food's id: what a pick sends. */
    readonly id: string;
    readonly name: string;
    /** The food most cooks mean by this noun (a seed default). It is tagged, and NEVER chosen for the cook. */
    readonly isDefault: boolean;
    /** A catalog variant's parts, drawn under the name ("Commercially prepared"). */
    readonly detailParts?: readonly [string, ...string[]];
}

/** What an open line needs from the cook. */
export type OpenNeed =
    /** The noun has a seed default (salt, pepper, milk, flour, cinnamon, rice): the cook still picks. */
    | {
          readonly kind: 'default';
          /** The noun the line names, as the prompt says it ("milk"). */
          readonly noun: string;
          readonly options: readonly FoodChoice[];
          /** The food a reopened line already holds (the cook pressed Change). */
          readonly chosenId: string | undefined;
      }
    /** More than one food fits, and none is the default. */
    | {
          readonly kind: 'needsChoice';
          readonly options: readonly FoodChoice[];
          readonly chosenId: string | undefined;
      }
    /** No food was found: search, or keep the line as written. */
    | { readonly kind: 'noMatch' };

/** A line that needs a pick: drawn open (one at a time on phone and 834) or as a collapsed row naming its need. */
export interface OpenLine {
    /** Stable identity among the lines. */
    readonly key: string;
    readonly line: PastedLineText;
    readonly need: OpenNeed;
}

/** A line that needs nothing from the cook now: its identity and text, and what its state can say. */
export type SettledLine = {
    /** Stable identity among the lines. */
    readonly key: string;
    readonly line: PastedLineText;
} & (
    | /** A confident match (an exact name, a curated mapping, or a match the review confirmed). It can be changed. */
      { readonly kind: 'matched'; readonly food: string }
      /** The cook's own pick. A late review result never replaces it: it adds one quiet sentence. */
    | {
          readonly kind: 'chosen';
          readonly food: string;
          /** The food a review that finished after the pick suggested instead. */
          readonly reviewNote: { readonly suggestedFood: string } | undefined;
      }
    /** The review is still running on a proposed food; it resolves into another state. */
    | { readonly kind: 'checking'; readonly proposal: string }
    /** The line's options did not load. */
    | { readonly kind: 'optionsFailed' }
    /** Kept as written, by the cook or by the daily limit (004 FR-022): no nutrition yet. */
    | { readonly kind: 'keptAsWritten' }
);

/** A notice above the pasted lines. */
export type PasteMatchNotice =
    /** Offline: the check waits, choices are kept where the draft is (D7). */
    | { readonly kind: 'offline'; readonly keep: DraftKeep }
    /** The daily limit (004 FR-022): the lines are kept as written until it resets in the cook's time zone. */
    | { readonly kind: 'quota'; readonly resetsAt: string; readonly timeZone: string };
