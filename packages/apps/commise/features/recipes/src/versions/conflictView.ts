/**
 * @module @commise/features-recipes/versions — The concurrent-edit conflict view's model: the banner and card copy, the staleness gate, and the
 * running summary of the viewer's choices.
 *
 * These four members (`isConflictBaseStale`, `MergeSelectionCounts`, `countMergeSelections`,
 * `formatMergeSummary`) sit here rather than in `merge.ts` because each needs the localized copy or a
 * locale, and `merge.ts` must stay free of both for `useRecipeEditor.ts` — see that module's docstring.
 *
 * @pattern Policy module — `isConflictBaseStale` + `STALE_VERSIONS_BEHIND_THRESHOLD` express the X6 ruling
 * as one pure predicate, the shape `visibilityPolicy.ts` and `provenancePolicy.ts` already establish.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type { VersionConflictSide } from '@kitchensink/recipe-core';
import { fillTemplate, formatRecipeCount } from '../list/model.js';
import type { ConflictDiff } from './conflictDiff.js';
import type { RecipeConflictMessages } from './messages.js';
import { formatRelativeTimeAgo, formatVersionTimestamp } from './timeFormat.js';
import { type RecipeMergeSelections } from './merge.js';

/**
 * Props for the concurrent-edit conflict view (T070 / C-005 / CP-6 P1 / W7) — a FULLY controlled,
 * presentational component. Server-first ordering (X7): `server` is always the FIRST/LEFT side, everywhere
 * this view renders anything two-sided — the per-side banner, and (Option C) the field-by-field merge panel.
 * It delegates every choice upward, including the field-by-field merge panel's own selection state:
 * `selections` comes in from the caller (the `useRecipeEditor` machine's `conflict.mergeSelections`) and every
 * toggle reports back via `onSelectionsChange` — this view owns no merge data of its own (only the "is the
 * merge panel showing" UI toggle stays local, since that is pure navigation, not data the machine needs).
 *
 * `mine`/`theirs` `RecipeDetail` display sides and the `mineTitle` override (the pre-W7 contract) are GONE:
 * the W7 body (`VersionConflictSide`) already carries everything the banner needs (`server`/`base`), and the
 * changed-only `diff` (W7 Task 1) is what the changed-fields panel below the cards renders — a `RecipeDetail`
 * projection of either side is no longer needed for THIS view (the Task 4 diff panel and Task 5 per-element
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
     *  Rendered as the changed-only diff panel below the three options, with a per-row marker + legend
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
    /** Option A: keep the server version, discarding the user's local changes. */
    readonly onKeepServer: () => void;
    /** Option B: overwrite the server version with the user's own draft. */
    readonly onOverwrite: () => void;
    /** Option C submit: invoked with the current per-field selections when the user saves a merge (FR-007c
     *  option c); the caller composes the merged draft (`composeConflictMerge`) and submits it. */
    readonly onMerge: (selections: RecipeMergeSelections) => void;
    /** The header "Discard and close" exit (wireframe gap #1 — `conflict-resolution.md:34`'s
     *  `[< Discard and close]`): abandons the local edit and leaves the conflict view WITHOUT resolving it —
     *  no `onKeepServer`/`onOverwrite`/`onMerge` fires. Rendered in BOTH the default (options) view and the
     *  merge panel, and — UNLIKE every other control on this view — is NEVER disabled by `isResolving`: it is
     *  the escape hatch a hung `onOverwrite`/`onMerge` request must not be able to trap the user behind (see
     *  `useRecipeEditor`'s `discardAndClose`). */
    readonly onDiscardAndClose: () => void;
}

/**
 * Render the server-side banner line: "Server version (v{n}): Saved {time}". Pure — the caller supplies
 * `now`.
 *
 * ⚠️ A ` on {device}` suffix hung off this line until the owner ruling of **2026-08-26** deleted device
 * attribution. There is now exactly ONE rendering; do not reintroduce the optional suffix.
 *
 * @param server - The 409's winning server side.
 * @param now - The current instant, supplied by the caller.
 * @param messages - The localized conflict copy.
 * @param locale - The active BCP-47 locale.
 * @returns The formatted server-side banner line.
 */
export const formatServerBanner = (
    server: VersionConflictSide,
    now: Date,
    messages: RecipeConflictMessages,
    locale: Locale,
): string =>
    fillTemplate(messages.serverBanner, {
        version: server.versionNumber,
        time: formatRelativeTimeAgo(server.updatedAt, now, locale),
    });

// ─── Two-column per-side summary cards (wireframe gap #2 — `conflict-resolution.md:46-50`) ──────────
//
// Below the prose banner above, the wireframe ALSO shows two dedicated cards — "SERVER VERSION (v6)" /
// "YOUR VERSION (v5)", each with a "Saved:" and (when known) a "Device:" row. This is a SEPARATE rendering
// of the same underlying data (versionNumber/updatedAt), not a replacement for the banner: the
// banner reads as a sentence with a RELATIVE time ("Saved 2 minutes ago"); the cards are a structured,
// scannable ABSOLUTE-date summary, matching the wireframe's own two distinct blocks. ⚠️ The wireframe's
// per-card "Device:" row went with the 2026-08-26 owner ruling on device attribution; what is left on a
// card is its heading and its Saved line. "Your version"'s data
// is `base` (the version the draft was edited from) — the wireframe's own `client_version`/`client_recipe`;
// `base` is ABSENT when evicted from version
// history, in which case the card falls back to a version-less heading with no Saved row (mirroring
// `mineBanner`'s own "local unsaved changes" framing for the same case).

/**
 * The SERVER card's heading — "Server version (v{n})" (wireframe gap #2). Pure.
 *
 * @param server - The 409's winning server side.
 * @param messages - The localized conflict copy.
 * @returns The formatted heading.
 */
export const formatServerCardHeading = (server: VersionConflictSide, messages: RecipeConflictMessages): string =>
    fillTemplate(messages.serverCardHeading, { version: server.versionNumber });

/**
 * The YOUR-version card's heading — "Your version (v{n})" when `base` is known, or the version-less
 * fallback when it was evicted from version history (wireframe gap #2). Pure.
 *
 * @param base - The 409's base side, or `undefined` when evicted.
 * @param messages - The localized conflict copy.
 * @returns The formatted heading.
 */
export const formatYourCardHeading = (
    base: VersionConflictSide | undefined,
    messages: RecipeConflictMessages,
): string =>
    base === undefined
        ? messages.yourCardHeadingUnknown
        : fillTemplate(messages.yourCardHeading, { version: base.versionNumber });

/**
 * A side's card "Saved: {date}" line — the ABSOLUTE localized date ({@link formatVersionTimestamp}),
 * deliberately distinct from the prose banner's own RELATIVE "N minutes ago" ({@link formatRelativeTimeAgo})
 * (wireframe gap #2). Pure.
 *
 * @param side - The card's own side (`server` or `base`).
 * @param locale - The active BCP-47 locale.
 * @param messages - The localized conflict copy.
 * @returns The formatted "Saved: {date}" line.
 */
export const formatVersionCardSavedLine = (
    side: VersionConflictSide,
    locale: Locale,
    messages: RecipeConflictMessages,
): string => fillTemplate(messages.versionCardSavedLabel, { time: formatVersionTimestamp(side.updatedAt, locale) });

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
 * @returns Whether the stale-base warning + confirm gate applies.
 */
export const isConflictBaseStale = (base: VersionConflictSide | undefined, versionsBehind: number): boolean =>
    base === undefined || versionsBehind > STALE_VERSIONS_BEHIND_THRESHOLD;

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
