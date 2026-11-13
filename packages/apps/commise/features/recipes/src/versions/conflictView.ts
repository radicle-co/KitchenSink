/**
 * @module @commise/features-recipes/versions — The concurrent-edit conflict view's model: the card copy, the staleness gate, the
 * running summary of the viewer's choices, and the prop contracts of the parts both leaves draw.
 *
 * These four members (`isConflictBaseStale`, `MergeSelectionCounts`, `countMergeSelections`,
 * `formatMergeSummary`) sit here rather than in `merge.ts` because each needs the localized copy or a
 * locale, and `merge.ts` must stay free of both for `useRecipeEditor.ts` — see that module's docstring.
 *
 * @pattern Policy module — `isConflictBaseStale` + `STALE_VERSIONS_BEHIND_THRESHOLD` express the X6 ruling
 * as one pure predicate, the shape `visibilityPolicy.ts` and `provenancePolicy.ts` already establish.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React at run time (the parts' contracts are types), no platform APIs.
 */
import { type Locale, fillTemplate } from '@commise/i18n';
import type { VariantPartsLineProps } from '@commise/ui/variant-parts-line';
import type { VersionConflictSide } from '@kitchensink/recipe-core';
import type { ReactNode } from 'react';
import { formatRecipeCount } from '../list/model.js';
import type { ConflictDiff } from './conflictDiff.js';
import type { RecipeConflictMessages } from './messages.js';
import { formatVersionTimestamp } from './timeFormat.js';
import { type RecipeMergeSelections } from './merge.js';

/**
 * Props for the concurrent-edit conflict view (T070 / C-005 / CP-6 P1 / W7) — a FULLY controlled,
 * presentational component. Server-first ordering (X7): `server` is always the FIRST/LEFT side, everywhere
 * this view renders anything two-sided — the two side cards, and (Compare) the field-by-field merge panel.
 * It delegates every choice upward, including the field-by-field merge panel's own selection state:
 * `selections` comes in from the caller (the `useRecipeEditor` machine's `conflict.mergeSelections`) and every
 * toggle reports back via `onSelectionsChange` — this view owns no merge data of its own (only the "is the
 * merge panel showing" UI toggle stays local, since that is pure navigation, not data the machine needs).
 *
 * No `mine`/`theirs` `RecipeDetail` display sides and no `mineTitle` override: the W7 body
 * (`VersionConflictSide`) carries everything the banner needs (`server`/`base`), and the changed-only `diff`
 * (W7 Task 1) is what the changed-fields panel below the cards renders — a `RecipeDetail` projection of
 * either side is not needed for THIS view (the Task 4 diff panel and Task 5 per-element
 * merge both read `diff.rows` instead).
 */
export interface RecipeConflictViewProps {
    /** The 409's winning server side (version/updatedAt/snapshot, W8-a.5) — the view's LEFT/FIRST side
     *  everywhere (X7). Drives the per-side banner (X3). */
    readonly server: VersionConflictSide;
    /** The version the draft was edited from, when still retained in the DB window; ABSENT when evicted (the
     *  base-evicted fallback — see `conflictDiff.ts`). Read directly by `isConflictBaseStale` (W7 Task 5 / X6)
     *  to decide whether the stale-base warning + confirm gate applies. */
    readonly base?: VersionConflictSide;
    /** The precomputed 3-way diff (`computeConflictDiff`, W7 Task 1) — changed-or-conflicting rows only.
     *  Rendered as the changed-only diff panel below the three options, with a per-row word badge
     *  (W7 Task 4 / X1). */
    readonly diff: ConflictDiff;
    /** `server.versionNumber - (base?.versionNumber ?? 0)` (the X6 staleness signal) — passed to
     *  `isConflictBaseStale` alongside `base` to render W7 Task 5's staleness warning and gate
     *  Overwrite/Save-merged on an explicit confirm. */
    readonly versionsBehind: number;
    /** Whether a resolve (`onOverwrite`/`onMerge`) is currently in flight — mirrors `useRecipeEditor`'s
     *  `state.isResolving` (concurrency/double-submit fix). While `true`, this FULLY controlled view disables
     *  all three option cards AND the merge panel's "Save merged version" button (combined with, not instead
     *  of, the existing stale-base confirm gate) so a rapid double-click/double-tap cannot fire a second
     *  resolve while the first is still outstanding — mirroring how the primary editor's Save/Publish buttons
     *  disable on `state.status === 'submitting'`. */
    readonly isResolving: boolean;
    /** The current per-field merge resolution (an absent key defaults to `'mine'`); owned by the caller. */
    readonly selections: RecipeMergeSelections;
    /** Invoked with the next selections on every per-field radio toggle, and to reset on merge-panel exit. */
    readonly onSelectionsChange: (selections: RecipeMergeSelections) => void;
    /** Use theirs: keep the server version, discarding the user's local changes. */
    readonly onKeepServer: () => void;
    /** Keep mine: overwrite the server version with the user's own draft. */
    readonly onOverwrite: () => void;
    /** Compare, submit: invoked with the current per-field selections when the user saves a merge (FR-007c
     *  option c); the caller composes the merged draft (`composeConflictMerge`) and submits it. */
    readonly onMerge: (selections: RecipeMergeSelections) => void;
    /** The header "Discard and close" exit (wireframe gap #1 — `conflict-resolution.md:34`'s
     *  `[< Discard and close]`): abandons the local edit and leaves the conflict view WITHOUT resolving it —
     *  no `onKeepServer`/`onOverwrite`/`onMerge` fires. Rendered in BOTH the default (options) view and the
     *  merge panel, and — UNLIKE every other control on this view — is NEVER disabled by `isResolving`: it is
     *  the escape hatch a hung `onOverwrite`/`onMerge` request must not be able to trap the user behind (see
     *  `useRecipeEditor`'s `discardAndClose`). */
    readonly onDiscardAndClose: () => void;
    /** Whether the recipe is a draft that was never published (ADR-0058): no versions, so no base. Swaps the copy
     *  for the draft's (`conflictCopyOf`) and lifts the stale-base gate. Absent means a published recipe. */
    readonly neverPublished?: boolean;
}

// ─── Two-column per-side summary cards (wireframe gap #2) ─────────────────────────────────────────────
//
// Two cards say whose changes are whose: THEIRS ("Saved elsewhere", with the time it was saved) and YOURS ("Your changes",
// "Not saved yet", with the time the draft started from when `base` is known). Neither names a version number: a cook
// does not know what "v6" is, and the 2026-10-27 bug sweep (finding #20) dropped them together with the prose banner
// that repeated the same data. ⚠️ The wireframe's per-card "Device:" row is not rendered (2026-08-26 owner ruling on
// device attribution). `base` is ABSENT when evicted from version history, in which case YOURS says only "Not saved yet".

/**
 * The THEIRS card's saved-time line — the ABSOLUTE localized date ({@link formatVersionTimestamp}). Pure.
 *
 * @param server - The 409's winning server side.
 * @param locale - The active BCP-47 locale.
 * @param messages - The localized conflict copy.
 * @returns The formatted saved-time line.
 */
export const formatTheirsCardSavedLine = (
    server: VersionConflictSide,
    locale: Locale,
    messages: RecipeConflictMessages,
): string => fillTemplate(messages.versionCardSavedLabel, { time: formatVersionTimestamp(server.updatedAt, locale) });

/**
 * The YOURS card's status line — "Not saved yet. Started from {date}" when `base` (the version the draft was edited
 * from) is known, or just "Not saved yet" when it was evicted from version history. Pure.
 *
 * @param base - The 409's base side, or `undefined` when evicted.
 * @param locale - The active BCP-47 locale.
 * @param messages - The localized conflict copy.
 * @returns The formatted status line.
 */
export const formatYoursCardStatus = (
    base: VersionConflictSide | undefined,
    locale: Locale,
    messages: RecipeConflictMessages,
): string =>
    base === undefined
        ? messages.yoursCardStatusUnknown
        : fillTemplate(messages.yoursCardStatus, { time: formatVersionTimestamp(base.updatedAt, locale) });

// ─── Selection-gating, choice summary + stale-base warning (W7 Task 5 / X5, X6) ─────────────────────
//
// The merge panel (Option C) must never silently resolve a field the user hasn't looked at, so the
// Save/Resolve action is GATED (X5) on at least one EXPLICIT selection existing, and a running "Summary of
// choices" line reports how the user's picks split between the two sides as they make them. Separately, a
// conflict whose common base is unusually far behind — or missing entirely — is riskier to resolve blindly
// (Overwrite/Save-merged can discard intervening changes the view never got to show), so that case (X6)
// requires an explicit confirm before either action proceeds.

/** More than this many versions behind is stale enough to warn on (X6). */
const STALE_VERSIONS_BEHIND_THRESHOLD = 10;

/**
 * Whether the 409's base is stale enough (X6) to require an explicit confirm before Overwrite/Save-merged
 * proceed: the base version was evicted from version history (`base === undefined`) OR the server is more
 * than {@link STALE_VERSIONS_BEHIND_THRESHOLD} versions ahead of it. Both conditions are checked
 * independently — `versionsBehind` ALONE is unreliable when `base` is absent (`useRecipeEditor` degrades it
 * to `server.versionNumber` itself in that case, an unrelated number that can easily land under the
 * threshold), so an absent base must warn regardless of what `versionsBehind` happens to read. Pure.
 *
 * @param base - The 409's base side, or `undefined` when evicted from version history.
 * @param versionsBehind - `server.versionNumber - (base?.versionNumber ?? 0)`, the X6 staleness signal.
 * @param neverPublished - A never-published draft has no versions, so no base to be stale against: never warns.
 * @returns Whether the stale-base warning + confirm gate applies.
 */
export const isConflictBaseStale = (
    base: VersionConflictSide | undefined,
    versionsBehind: number,
    neverPublished = false,
): boolean => !neverPublished && (base === undefined || versionsBehind > STALE_VERSIONS_BEHIND_THRESHOLD);

/**
 * The conflict copy for this recipe. A never-published draft records no versions (ADR-0058), so its 409 never has a
 * `base`: its copy speaks of a draft saved elsewhere, with no "evicted" fallback. Pure.
 *
 * @param messages - The localized conflict copy.
 * @param neverPublished - Whether the recipe is a draft that was never published.
 * @returns `messages` itself for a published recipe; otherwise `messages` with the `draft*` slots laid over their twins.
 */
export const conflictCopyOf = (messages: RecipeConflictMessages, neverPublished: boolean): RecipeConflictMessages =>
    neverPublished
        ? {
              ...messages,
              heading: messages.draftHeading,
              explanation: messages.draftExplanation,
          }
        : messages;

/** How the user's EXPLICIT per-field/per-element merge picks (W7 Task 5's running "Summary of choices")
 *  currently split between the two sides. An absent key (still defaulting to "mine" for composition — see
 *  `composeMergedRecipe` in `merge.ts`) is NOT counted here: the summary reports what the user has actively chosen,
 *  not the composed result, so it reads "0, 0" until the first deliberate pick. */
export interface MergeSelectionCounts {
    /** Rows explicitly resolved to the server's value. */
    readonly server: number;
    /** Rows explicitly resolved to the user's own draft value. */
    readonly mine: number;
}

/**
 * Tally {@link RecipeMergeSelections} by chosen side. Pure.
 *
 * @param selections - The current per-field/per-element resolution.
 * @returns How many selections went to the server's value vs. the user's own.
 */
export const countMergeSelections = (selections: RecipeMergeSelections): MergeSelectionCounts => {
    const sides = Object.values(selections);

    return {
        server: sides.filter((side) => side === 'theirs').length,
        mine: sides.filter((side) => side === 'mine').length,
    };
};

/**
 * Render the running "Summary of choices" line (W7 Task 5): how many of the user's picks went to the
 * server's value vs. their own, each correctly pluralized via the SAME one/other-template pattern every
 * other count in this module uses (e.g. `formatChangedFromCurrent`'s (`preview.ts`) ingredient/step counts). Pure.
 *
 * @param selections - The current per-field/per-element resolution.
 * @param messages - The localized conflict copy (the summary templates).
 * @param locale - The active BCP-47 locale (for count pluralization).
 * @returns The formatted "Summary of choices" line.
 */
export const formatMergeSummary = (
    selections: RecipeMergeSelections,
    messages: RecipeConflictMessages,
    locale: Locale,
): string => {
    const counts = countMergeSelections(selections);

    return fillTemplate(messages.mergeSummaryTemplate, {
        server: formatRecipeCount(
            counts.server,
            { one: messages.mergeSummaryServerCountOne, other: messages.mergeSummaryServerCountOther },
            locale,
        ),
        mine: formatRecipeCount(
            counts.mine,
            { one: messages.mergeSummaryMineCountOne, other: messages.mergeSummaryMineCountOther },
            locale,
        ),
    });
};

// ─── The parts both leaves draw ─────────────────────────────────────────────────────────────────────

/**
 * One option card (X2, T5: Compare, Keep mine, Use theirs): a title, a description, and the choice it fires. `disabled` is the stale-base confirm
 * gate on Keep mine (W7 Task 5 / X6); Use theirs and Compare are never gated that way.
 */
export interface ConflictOptionCardProps {
    readonly title: string;
    readonly description: string;
    readonly onChoose: () => void;
    readonly disabled?: boolean;
}

/** The header "Discard and close" exit (wireframe gap #1, `conflict-resolution.md:34`). */
export interface DiscardAndCloseProps {
    readonly label: string;
    readonly onDiscardAndClose: () => void;
}

/** One per-side summary card (wireframe gap #2): its heading, and its status line (saved time, or "Not saved yet"). */
export interface VersionSideCardProps {
    readonly heading: string;
    readonly statusLine: string;
}

/** One side's value, and that side's variant parts when it is variant-bound (curated U15, R25). */
export interface SideValueProps {
    readonly children: ReactNode;
    readonly parts: VariantPartsLineProps['parts'] | undefined;
}

/** The stale-base warning and its explicit confirmation (W7 Task 5 / X6). */
export interface StaleBaseWarningProps {
    readonly warning: string;
    readonly confirmLabel: string;
    readonly confirmed: boolean;
    readonly onConfirmedChange: (confirmed: boolean) => void;
}
