/**
 * @module @commise/features-recipes/hooks — what a cook can commit on an ingredient row, and the ONE decision of which
 * path carries it.
 *
 * Two paths exist, and ADR-0045 (lines 265-269) is why: an ordinary recipe save records no correction even when a
 * line's binding changes, so re-pointing a line the server already STORES teaches (plan 002 R17) only through the
 * rebind command. Everything else — every line on the create form, a line added this session, a declaration — is a
 * draft transition that the next save persists.
 *
 * ⛔ A candidate pick for an `UNRESOLVED` row is NOT a member of this union. It is a server write on the binding, the
 * same on both forms, owned by that row's own panel mutation (blueprint §F); routing it here as `draft` would make the
 * draft adapter decide the route a second time (staff-architect REVIEW F2). An `AMBIGUOUS` row's shortlist pick IS one:
 * it binds that line alone (owner ruling 2026-10-02), so it is an ordinary pick on the line (`../form/shortlistPanel.model.ts`).
 *
 * ⛔ {@link commitRouteFor} is the only place the choice is made. A second `if (persisted)` elsewhere is how a
 * persisted line ends up re-pointed by a plain save and teaches nothing.
 *
 * Pure: no React, no client calls. `useLineCommit` (`./useLineCommit.ts`) runs the strategy this module selects.
 *
 * @pattern Strategy — {@link commitRouteFor} selects the command or the draft strategy for one pick
 * @pattern Port — {@link LineCommandPort}, the command's half that the editor implements (`useRecipeEditor`)
 */
import {
    isRemoteFoodGoneError,
    isRequesterLimitReachedError,
    isSourceBusyError,
} from '@kitchensink/food-service-client';
import {
    quantityLowerBound,
    type Ingredient,
    type IngredientQuantity,
    type RecipeDetail,
} from '@kitchensink/recipe-core';
import type { RebindIngredientLineRequest } from '@kitchensink/schema-recipe';

import type { LineBinding } from '../form/lineBinding.js';
import { storedPositionOf, type IngredientLineKey } from '../form/lineKey.js';
import type { ResolvedRecipeFormIngredient } from '../form/draftAction.js';
import { limitEndOf } from './sourceLimit.model.js';

/** A pick a line can be committed with: our catalog's food or variant, a name to resolve, or a declaration. */
export type BoundPick =
    /** A food from our database (the cook's own or the catalog's), a remote food once adopted, or a food the cook just
     * made. */
    | { readonly kind: 'catalogFood'; readonly foodId: string; readonly name: string }
    /** A variant, from the details dialog (blueprint decision 7). Removing details is a `catalogFood` pick of the root. */
    | { readonly kind: 'catalogVariant'; readonly foodVariantId: string }
    /** A name to resolve as typed. */
    | { readonly kind: 'name'; readonly text: string }
    /** "Use as written": a declaration. It has no rebind target. */
    | { readonly kind: 'declared'; readonly text: string };

/**
 * A remote source's food (ADR-0055 point 10): picked by the reference food issued, it is adopted into a catalog root
 * first, and the line is then committed with that root as a `catalogFood` pick. So no route ever sees it.
 */
export interface RemoteFoodPick {
    readonly kind: 'remoteFood';
    /** The sealed reference food issued with the hit, sent back unread. */
    readonly reference: string;
    /** The name its root carries, so the pick never renames what the cook chose. */
    readonly name: string;
    /** The source's register id: the row says where it is adding from (P8). */
    readonly source: string;
}

/** What the cook chose for a row. */
export type IngredientPick = BoundPick | RemoteFoodPick;

/**
 * The measure the cook typed in front of the food on the trailing add row (`../form/leadingMeasure.ts`, blueprint A1).
 * The appended line is committed with it. It is the cook's own statement: nothing later overwrites it (A2).
 */
export interface LineMeasure {
    readonly quantity: IngredientQuantity;
    /** `normalizeUnit`'s spelling; `''` when none. */
    readonly unit: string;
    /** `''` when none. */
    readonly preparation: string;
}

/**
 * Which line a pick lands on: an existing row, by key, or the trailing add row. A trailing pick carries the measure read
 * from the field's text when it was made; it is not part of the target's identity (one trailing row, one commit).
 */
export type LineCommitTarget =
    | { readonly kind: 'line'; readonly key: IngredientLineKey }
    | { readonly kind: 'newLine'; readonly measure?: LineMeasure };

/** How one commit ended. */
export type LineCommitOutcome =
    /**
     * The line now names `binding`. `key` is the line's key, minted for an appended line. An `UNRESOLVED` binding is
     * committed as it is; its row offers the choice.
     */
    | { readonly kind: 'committed'; readonly key: IngredientLineKey; readonly binding: LineBinding }
    /** Nothing changed: the request was refused or did not answer. */
    | { readonly kind: 'failed' }
    /** The recipe changed since the editor read it: nothing changed, and the editor shows its conflict view. */
    | { readonly kind: 'conflict' }
    /** A commit for this target is already in flight, so this one was not started. */
    | { readonly kind: 'busy' }
    /** A remote pick food refused: the item is retired, gone from its source, or its reference unreadable (`409`). */
    | { readonly kind: 'remoteGone' }
    /** A remote pick food could not make now: the source is busy, or a background fetch holds the food (`503`). */
    | { readonly kind: 'sourceBusy' }
    /** A remote pick the cook's own limit on source lookups refused, until `retryAt` (epoch milliseconds). */
    | { readonly kind: 'limited'; readonly retryAt: number };

/** Why a remote pick put no food on its line (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P8). */
export type RemotePickRefusal = Extract<
    LineCommitOutcome,
    { kind: 'failed' | 'remoteGone' | 'sourceBusy' | 'limited' }
>;

/**
 * Whether a commit settled with no food on its line: it failed, food refused it, or the cook's limit held it. A
 * conflict and a `busy` refusal are not: one opens the editor's conflict view, and the other never started. Pure.
 *
 * @param outcome - How the commit settled.
 * @returns `true` for a refusal.
 */
export const isPickRefusal = (outcome: LineCommitOutcome): outcome is RemotePickRefusal => {
    switch (outcome.kind) {
        case 'failed':
        case 'remoteGone':
        case 'sourceBusy':
        case 'limited':
            return true;
        case 'committed':
        case 'conflict':
        case 'busy':
            return false;
    }
};

/**
 * How a refused adopt ends a remote pick (P8): food refused the item, the source or a drain was busy, or the cook's own
 * limit stands, held to the minute item 10 rounds its end up to. Anything else, no answer included, is a plain failure
 * that choosing the hit again retries. Every surface that adopts reads it, so each refusal means one thing. Pure.
 *
 * @param error - What the adopt rejected with.
 * @param receivedAt - When, in epoch milliseconds, for the limit's end.
 * @returns The refusal.
 */
export const adoptRefusalOf = (error: unknown, receivedAt: number): RemotePickRefusal => {
    if (isRemoteFoodGoneError(error)) {
        return { kind: 'remoteGone' };
    }

    if (isRequesterLimitReachedError(error)) {
        return { kind: 'limited', retryAt: limitEndOf(receivedAt + error.retryAfterSeconds * 1000) };
    }

    return isSourceBusyError(error) ? { kind: 'sourceBusy' } : { kind: 'failed' };
};

/** Commits one pick on one target: `useLineCommit`'s `commit`, which every surface that picks is handed. */
export type LineCommitPort = (pick: IngredientPick, target: LineCommitTarget) => Promise<LineCommitOutcome>;

/** Where one rebind command goes. Read when the command is SENT, never when the cook picks (blueprint decision 7). */
export interface LineCommandAddress {
    readonly recipeId: string;
    /** The line's stored position (`storedPositionOf`). */
    readonly position: number;
    /** The version the surface's content is built on. */
    readonly expectedVersion: number;
}

/** Sends the rebind command to one address and answers with the recipe it produced (`useRebindIngredientLine`). */
export type LineCommandSend = (address: LineCommandAddress) => Promise<RecipeDetail>;

/** How one rebind command ended, as the surface that ran it adopted it. */
export type LineCommandOutcome =
    /** The command made a version, and the surface now holds the line on `binding`. */
    | { readonly kind: 'committed'; readonly binding: LineBinding }
    /** The recipe changed since the surface read it. */
    | { readonly kind: 'conflict' }
    /** Nothing changed. */
    | { readonly kind: 'failed' };

/**
 * A surface's half of the rebind command: which lines it stores, and how it runs one command and adopts the version it
 * returns (ADR-0045). The editor implements it on the edit form.
 */
export interface LineCommandPort {
    /** The stored lines' keys, in stored order (`persistedLineKeysOf`). */
    readonly persistedKeys: readonly IngredientLineKey[];
    /** Run the command for the line with `key` through `send`, and adopt what it returns. */
    readonly run: (key: IngredientLineKey, send: LineCommandSend) => Promise<LineCommandOutcome>;
}

/** The rebind command's target, derived from the published request so it cannot drift (ADR-0014). */
type RebindTarget = RebindIngredientLineRequest['target'];

/** The decision: the command at a stored position, or the draft. */
export type CommitRoute =
    | { readonly route: 'command'; readonly position: number; readonly target: RebindTarget }
    | { readonly route: 'draft' };

/** The rebind target a pick names, or `undefined` when it names none. */
const rebindTargetOf = (pick: BoundPick): RebindTarget | undefined => {
    switch (pick.kind) {
        case 'catalogFood':
            return { kind: 'catalogFood', foodId: pick.foodId };
        case 'catalogVariant':
            return { kind: 'catalogVariant', foodVariantId: pick.foodVariantId };
        case 'name':
            return { kind: 'name', name: pick.text };
        case 'declared':
            return undefined;
    }
};

/**
 * Which path commits `pick` on `target`. Pure.
 *
 * @param pick - What the cook chose.
 * @param target - The row it lands on.
 * @param persistedKeys - The stored lines' keys, in stored order (`persistedLineKeysOf`). Empty on the create form.
 * @returns The command at the line's stored position, or the draft.
 */
export const commitRouteFor = (
    pick: BoundPick,
    target: LineCommitTarget,
    persistedKeys: readonly IngredientLineKey[],
): CommitRoute => {
    if (target.kind === 'newLine') {
        return { route: 'draft' };
    }

    const rebindTarget = rebindTargetOf(pick);
    const position = storedPositionOf(persistedKeys, target.key);

    if (rebindTarget === undefined || position === undefined) {
        return { route: 'draft' };
    }

    return { route: 'command', position, target: rebindTarget };
};

/**
 * Project a catalog `Ingredient` onto a resolved form line STATING NO AMOUNT (build spec F5): a pick is a food, not a
 * measure, so the line carries the draft's spelling of absent (`NaN`, the one `toRecipeFormValues` seeds an amount-less
 * stored line with) until the cook types one. It used to invent a `1`, which then published as the cook's own figure.
 *
 * Carries the ingredient's food (its root and any variant), never its figures: the editor's one background nutrition
 * read supplies those (plan 002 V1 B5), so a fresh pick and a reopened recipe total the same way.
 *
 * ⛔ ITS RETURN TYPE IS THE NARROWED {@link ResolvedRecipeFormIngredient}, and that is U28's load-bearing
 * seam rather than a tidy-up. `ingredient.id` is a `string`, so this function has ALWAYS produced a resolved
 * line — it merely DECLARED a possibly-unresolved one, and every downstream null-check, every over-wide
 * callback and (on mobile) a whole lossy re-projection existed to cope with a nullability this adapter
 * invented. Narrowing here is what makes "an unresolved row cannot be appended" a compile-time fact all the
 * way from the catalog response to `appendResolvedIngredient`, instead of a filter at the last hop. Pure.
 */
export function toIngredientLine(ingredient: Ingredient): ResolvedRecipeFormIngredient {
    return {
        ingredientId: ingredient.id,
        name: ingredient.name,
        // ⛔ THE ADD PATH CARRIES IT TOO. Dropping it here would leave a freeform line added in this
        // session indistinguishable from a food-backed one until the recipe is reloaded.
        // ⚠️ FORWARDED, never re-derived — the service owns what this flag means, and this adapter has no
        // view of the binding it is derived from.
        isUserEntered: ingredient.isUserEntered,
        quantity: Number.NaN,
        ...(ingredient.foodResolutionStatus === undefined ? {} : { resolutionStatus: ingredient.foodResolutionStatus }),
        // Plan 002 V1 B5 / curated U9 — the food, never its figures: the editor's one background read supplies those
        // (blueprint Decision 3), so a fresh pick and a reopened recipe total the same way. A picked variant stays a
        // variant, so the line reads the variant's numbers (`foodRefOf`).
        ...(ingredient.foodId === undefined ? {} : { foodId: ingredient.foodId }),
        ...(ingredient.variant === undefined ? {} : { variant: ingredient.variant }),
    };
}

/**
 * A picked line with the measure the cook typed in front of its food (blueprint A2): the amount, its upper bound for a
 * range, the unit and the preparation. ⛔ Nothing of the typed text itself: a typed-then-picked line is an AUTHORED line,
 * so it carries no `sourceLine`, `sourcePhrase` or `statedMeasure` and never reaches the verification gate. Absent facts
 * stay absent (an empty unit or preparation is omitted, never sent as `''`). Pure.
 *
 * @param line - The picked line (`toIngredientLine`), stating no amount.
 * @param measure - What the cook typed in front of the food, if anything.
 * @returns The line, measured.
 */
export function withLineMeasure(
    line: ResolvedRecipeFormIngredient,
    measure: LineMeasure | undefined,
): ResolvedRecipeFormIngredient {
    if (measure === undefined) {
        return line;
    }

    const { quantity, unit, preparation } = measure;

    return {
        ...line,
        quantity: quantityLowerBound(quantity) ?? Number.NaN,
        ...(quantity.kind === 'range' ? { quantityHigh: quantity.high } : {}),
        ...(unit === '' ? {} : { unit }),
        ...(preparation === '' ? {} : { preparation }),
    };
}

/**
 * The binding half of a resolved line (`LineBinding`): what a re-point carries, and nothing the cook wrote. Absent
 * facts stay absent rather than becoming `undefined` keys. Pure.
 *
 * @param line - A line that names a binding.
 * @returns Its binding.
 */
export const lineBindingOf = (line: ResolvedRecipeFormIngredient): LineBinding => ({
    ingredientId: line.ingredientId,
    isUserEntered: line.isUserEntered,
    ...(line.name === undefined ? {} : { name: line.name }),
    ...(line.resolutionStatus === undefined ? {} : { resolutionStatus: line.resolutionStatus }),
    ...(line.unresolvedReason === undefined ? {} : { unresolvedReason: line.unresolvedReason }),
    ...(line.foodId === undefined ? {} : { foodId: line.foodId }),
    ...(line.variant === undefined ? {} : { variant: line.variant }),
});

/** A rebind command as the editor queues it: the line, how to send it, and how to answer the caller. */
export interface QueuedLineCommand {
    readonly key: IngredientLineKey;
    /** Sends the command. A second call answers with the first call's answer: it goes on the wire once. */
    readonly send: LineCommandSend;
    /** `true` the first time only: the one caller that adopts the answer. */
    readonly claim: () => boolean;
    /** Answers the caller's promise. */
    readonly settle: (outcome: LineCommandOutcome) => void;
}

/**
 * A queued command that sends once and is adopted once, however often the effect that sends it runs (a remount or a
 * Fast Refresh re-runs effects). A second POST at the same version would meet a 409 against the editor's own write.
 *
 * @param key - The line.
 * @param send - Sends the command (`useRebindIngredientLine`).
 * @param settle - Answers the caller.
 * @returns The command.
 */
export const onceLineCommand = (
    key: IngredientLineKey,
    send: LineCommandSend,
    settle: (outcome: LineCommandOutcome) => void,
): QueuedLineCommand => {
    let sent: Promise<RecipeDetail> | undefined;
    let claimed = false;

    return {
        key,
        send: (address) => {
            sent ??= send(address);

            return sent;
        },
        claim: () => {
            const first = !claimed;

            claimed = true;

            return first;
        },
        settle,
    };
};
