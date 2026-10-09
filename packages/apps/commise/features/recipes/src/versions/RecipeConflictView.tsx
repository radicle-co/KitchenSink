'use client';

/**
 * @module @commise/features-recipes — web concurrent-edit conflict view (T070 / C-005 / W7 building block).
 *
 * `'use client'` is required: this leaf holds state (`useConflictView`) for the field-by-field merge mode, and it is
 * re-exported through the package barrel into the Next.js App-Router server tree (`app/[locale]/page.tsx`),
 * so without the directive `next build` fails the React Server Component boundary check (tsc/vitest do not
 * enforce it — only the production build does). No-op for the mobile `.native.tsx` variant (Metro ignores it).
 *
 * FULLY controlled, presentational conflict resolver for FR-007c. This is the W7 rebuild of the DEFAULT
 * (options) view (Task 3): a per-side banner (X3, server ALWAYS first — X7), three A/B/C option cards (X2)
 * — [A] keep server, [B] overwrite with mine, [C] merge field by field — and the changed-only diff panel
 * (W7 Task 4 / X1) below the cards, driven by the precomputed `ConflictDiff` (W7 Task 1): one row PER
 * changed-or-conflicting field/element, each with an accessible marker (`[→]` changed / `[!!]` conflict —
 * text/role, never colour alone) and Server-then-Yours values (X7), plus a legend.
 *
 * Merge mode (Option C, W7 Task 5) renders ONLY `diff.rows` — the CHANGED fields/elements, one radiogroup
 * per row, Server FIRST then Yours (X7), reusing `conflictRowLabel` so a merge
 * row can never disagree with the diff panel above on how it names itself. Selecting is the user's EXPLICIT
 * choice: no radio is pre-checked, so the running "Summary of choices" starts at zero and the Save/Resolve
 * action is GATED (X5) on at least one selection existing. A base that was evicted from version history, or
 * is more than 10 versions behind (X6), additionally requires an explicit confirm before Overwrite OR
 * Save-merged proceeds — `isConflictBaseStale` gates both actions the same way regardless of which screen
 * they live on. Nothing is auto-merged; every field's resolution is the user's explicit choice. `selections`
 * comes in from the caller (the `useRecipeEditor` machine's `conflict.mergeSelections`) and every toggle
 * reports back via `onSelectionsChange` — this view owns no merge data of its own. Only the merge-panel-
 * visible toggle and the stale-confirm checkbox stay local (pure UI state, not data the machine needs) —
 * and BOTH reset whenever `server.versionNumber` changes, i.e. whenever a NEW conflict (not merely a
 * re-render of the SAME one) arrives on this component instance, so neither can leak across conflicts. That
 * state and its gates are `useConflictView`'s, shared with the native leaf.
 */

// ⛔ NO `px-*` HERE. This renders inside `AppShell`'s `<main>`, which already supplies `px-4 md:px-6`, so a
// second `px-4` doubled the gutter to 32px a side — at 320 that leaves 256px of content. The section keeps
// `mx-auto max-w-3xl` because centering is its own job; the gutter is the shell's.
import { Button, busyControlProps } from '@commise/ui/button';
import { useLocale, useMessages } from '@commise/i18n/react';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useId } from 'react';
import type { ChangeEvent, FC } from 'react';

import { conflictSideParts } from './conflictDiff.js';
import { recipeVersionMessages } from './messages.js';
import { fillTemplate } from '../list/model.js';
import {
    LEGEND_MARKERS,
    type ConflictOptionCardProps,
    type DiscardAndCloseProps,
    type RecipeConflictViewProps,
    type SideValueProps,
    type StaleBaseWarningProps,
    type VersionSideCardProps,
    conflictCopyOf,
    formatMergeSummary,
    formatServerBanner,
    formatServerCardHeading,
    formatVersionCardSavedLine,
    formatYourCardHeading,
} from './conflictView.js';
import {
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictOptionLabel,
    conflictOptionName,
    conflictRowLabel,
    conflictRowName,
} from './diffLabels.js';
import { useConflictView } from './useConflictView.js';

/**
 * How this view dims a control it will not act on, stated once for the natively disabled (a rule the press did
 * not cause) and the busy (`aria-disabled`, a resolve in flight) states alike, so one screen shows one level of
 * "unavailable". The shared `BUSY_CONTROL_CLASS` dims to 60%; this view has always dimmed to 50%.
 */
const UNAVAILABLE_CLASS =
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * One A/B/C option card — a title, a description, and the choice it fires. `aria-label` pins the button's
 * accessible NAME to the title alone (its computed-from-content name would otherwise run the description
 * text on too, e.g. "Keep server version Discard your local changes…"); `aria-describedby` still attaches
 * the description as the button's accessible DESCRIPTION, so assistive tech reads both, just not run
 * together as one name. `disabled` (W7 Task 5 / X6) is the stale-base confirm gate on Option B (Overwrite)
 * — Option A and C are never gated this way (see the module doc). `busy` is a resolve in flight: a card the cook
 * just pressed must keep focus, so it is `aria-disabled` with the press refused (`busyControlProps`), never native
 * `disabled`. A blocked card stays natively `disabled` through a resolve: the cook cannot have pressed it, so it
 * has no focus to keep and must not join the tab order only to be disabled again if the resolve fails.
 */
const OptionCard: FC<ConflictOptionCardProps & { readonly busy: boolean }> = ({
    title,
    description,
    onChoose,
    disabled = false,
    busy,
}) => {
    const descriptionId = useId();

    return (
        <button
            type="button"
            {...busyControlProps({ busy: busy && !disabled, blocked: disabled, onClick: onChoose })}
            aria-label={title}
            aria-describedby={descriptionId}
            className={`flex flex-1 flex-col gap-1 rounded-2xl bg-paper p-5 text-left shadow-sm ring-1 ring-line-divider transition hover:bg-ink/6 disabled:hover:bg-paper aria-disabled:hover:bg-paper ${UNAVAILABLE_CLASS}`}
        >
            <span aria-hidden="true" className="font-display text-body-lg font-semibold text-ink">
                {title}
            </span>
            <span id={descriptionId} className="text-body-sm text-ink-muted">
                {description}
            </span>
        </button>
    );
};

/**
 * The header "Discard and close" exit (wireframe gap #1 — `conflict-resolution.md:34`). Rendered identically
 * in BOTH the default (options) view and the merge panel, and — UNLIKE every other control on this view —
 * NEVER disabled: it is the escape hatch a hung `onOverwrite`/`onMerge` resolve must not be able to trap the
 * user behind (`useRecipeEditor`'s `discardAndClose` stays callable regardless of `isResolving`). `aria-
 * label` pins the accessible name to the label alone; the decorative leading glyph is `aria-hidden` (mirrors
 * `OptionCard`'s own name-vs-visible-content split).
 */
const DiscardAndCloseButton: FC<DiscardAndCloseProps> = ({ label, onDiscardAndClose }) => (
    <button
        type="button"
        onClick={onDiscardAndClose}
        aria-label={label}
        className="self-start text-body-sm font-semibold text-ink-muted transition hover:text-ink"
    >
        <span aria-hidden="true">{'‹ '}</span>
        {label}
    </button>
);

/**
 * One two-column per-side summary card (wireframe gap #2 — `conflict-resolution.md:46-50`) — a heading plus
 * an optional "Saved:" line and an optional "Device:" line, omitted (never fabricated) when the underlying
 * side carries no such data. Rendered ONLY in the default (options) view — the merge panel does not repeat
 * it (see `model.ts`'s own module note on why this is a SEPARATE rendering of the banner's data, not a
 * replacement for it).
 */
const VersionSideCard: FC<VersionSideCardProps> = ({ heading, savedLine }) => (
    <div className="flex-1 rounded-2xl bg-paper p-4 ring-1 ring-line-divider">
        <p className="text-caption font-semibold uppercase tracking-wide text-ink">{heading}</p>
        {savedLine !== undefined && <p className="text-body-sm text-ink-muted">{savedLine}</p>}
    </div>
);

/**
 * One side's value and, when that side is variant-bound, its dotted line under it (curated U15, R25), in a block of
 * their own so the line reads with its side rather than the next one. Phrasing content, so it also fits in a `<label>`.
 */
const SideValue: FC<SideValueProps> = ({ children, parts }) => (
    <span className="flex min-w-0 flex-col gap-1">
        {children}
        {parts !== undefined && <VariantPartsLine parts={parts} tone="secondary" />}
    </span>
);

/**
 * The stale-base warning + explicit confirm checkbox (W7 Task 5 / X6) — shared, unchanged markup between the
 * options view (gates Overwrite) and the merge panel (gates Save merged version), so the two can never drift
 * on wording or behavior. `role="alert"` (mirrors `RecipeDeleteDialog`'s own alert-role warning surfaces).
 */
const StaleBaseWarning: FC<StaleBaseWarningProps> = ({ warning, confirmLabel, confirmed, onConfirmedChange }) => (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-attention-tint p-4 ring-1 ring-warning">
        <p className="text-body-sm text-ink">{warning}</p>
        <label className="flex items-center gap-2 text-body-sm font-medium text-ink">
            <input
                type="checkbox"
                checked={confirmed}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onConfirmedChange(event.target.checked)}
            />
            {confirmLabel}
        </label>
    </div>
);

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    server,
    base,
    diff,
    versionsBehind,
    isResolving,
    selections,
    onSelectionsChange,
    onKeepServer,
    onOverwrite,
    onMerge,
    onDiscardAndClose,
    neverPublished = false,
}) => {
    const conflict = conflictCopyOf(useMessages(recipeVersionMessages).conflict, neverPublished);
    const locale = useLocale();
    const view = useConflictView({ server, base, versionsBehind, neverPublished, selections, onSelectionsChange });

    // Reading the clock is THIS component's own side effect (mirrors `HomeGreeting`'s split of "the caller
    // reads `new Date()`, the pure formatter only maps an instant to a string") — `formatServerBanner`/
    // `formatRelativeTimeAgo` stay pure and testable without freezing time.
    const now = new Date();

    const staleWarning = view.isStale ? (
        <StaleBaseWarning
            warning={conflict.staleBaseWarning}
            confirmLabel={conflict.staleBaseConfirmLabel}
            confirmed={view.staleConfirmed}
            onConfirmedChange={view.setStaleConfirmed}
        />
    ) : null;

    if (view.merging) {
        return (
            <section aria-label={conflict.mergeHeading} className="mx-auto flex max-w-3xl flex-col gap-4 py-8">
                <DiscardAndCloseButton label={conflict.discardAndClose} onDiscardAndClose={onDiscardAndClose} />
                <h2 className="font-display text-heading-lg font-semibold text-ink">{conflict.mergeHeading}</h2>
                <p className="text-body-md text-ink-muted">{conflict.mergeExplanation}</p>
                {staleWarning}
                <div className="flex flex-col gap-3">
                    {diff.rows.map((row) => {
                        const label = conflictRowLabel(row, conflict);
                        const current = view.sideOf(row.key);

                        return (
                            <fieldset
                                key={row.key}
                                role="radiogroup"
                                // The name carries a variant's parts (R27); the legend stays the plain label (R25).
                                aria-label={conflictRowName(row, conflict)}
                                className="flex flex-col gap-2 rounded-2xl bg-paper p-4 ring-1 ring-line-divider"
                            >
                                <legend className="text-caption uppercase tracking-wide text-ink-muted">{label}</legend>
                                {/* Server FIRST, then Yours (X7). */}
                                {(['theirs', 'mine'] as const).map((side) => (
                                    <label key={side} className="flex items-start gap-2 text-body-md text-ink">
                                        <input
                                            type="radio"
                                            name={row.key}
                                            aria-label={conflictOptionName(row, side, conflict)}
                                            checked={current === side}
                                            onChange={() => view.choose(row.key, side)}
                                            className="mt-1.5"
                                        />
                                        <SideValue parts={conflictSideParts(row, side)}>
                                            <span>{conflictOptionLabel(row, side, conflict)}</span>
                                        </SideValue>
                                    </label>
                                ))}
                            </fieldset>
                        );
                    })}
                </div>
                <p aria-live="polite" className="text-body-sm font-medium text-ink">
                    {formatMergeSummary(selections, conflict, locale)}
                </p>
                {!view.hasSelection && (
                    <p role="status" className="text-body-sm text-ink-muted">
                        {conflict.mergeNoSelectionHint}
                    </p>
                )}
                <div className="flex flex-wrap gap-3">
                    {/* The selection and stale-base gates are rules the press did not cause (`disabled`); a resolve in
                        flight follows the press, so Save keeps focus (the Button's `busy` owns that precedence). */}
                    <Button
                        icon="check"
                        busy={isResolving}
                        disabled={view.mergeBlocked}
                        onPress={() => onMerge(selections)}
                    >
                        {conflict.mergeSubmit}
                    </Button>
                    <Button variant="secondary" icon="chevronLeft" onPress={view.leaveMerge}>
                        {conflict.mergeBack}
                    </Button>
                </div>
            </section>
        );
    }

    return (
        <section aria-label={conflict.heading} className="mx-auto flex max-w-3xl flex-col gap-4 py-8">
            <DiscardAndCloseButton label={conflict.discardAndClose} onDiscardAndClose={onDiscardAndClose} />
            <h2 className="font-display text-heading-lg font-semibold text-ink">{conflict.heading}</h2>
            <p className="text-body-md text-ink-muted">{conflict.explanation}</p>

            {/* Per-side banner (X3) — server is ALWAYS first (X7). */}
            <div className="flex flex-col gap-1 rounded-2xl bg-paper p-4 ring-1 ring-line-divider">
                <p className="text-body-md text-ink">{formatServerBanner(server, now, conflict, locale)}</p>
                <p className="text-body-md text-ink">{conflict.mineBanner}</p>
            </div>

            {/* Two-column per-side summary cards (wireframe gap #2) — server ALWAYS first (X7). */}
            <div className="flex flex-col gap-4 sm:flex-row">
                <VersionSideCard
                    heading={formatServerCardHeading(server, conflict)}
                    savedLine={formatVersionCardSavedLine(server, locale, conflict)}
                />
                <VersionSideCard
                    heading={formatYourCardHeading(base, conflict)}
                    {...(base === undefined
                        ? {}
                        : {
                              savedLine: formatVersionCardSavedLine(base, locale, conflict),
                          })}
                />
            </div>

            {/* Stale-base warning (W7 Task 5 / X6) — gates Overwrite below. */}
            {staleWarning}

            {/* Three A/B/C option cards (X2). `isResolving` (concurrency/double-submit fix) busies ALL three —
                combined with, not replacing, Overwrite's existing stale-base gate — while a resolve is in flight,
                so a rapid double-click cannot fire a second resolve before the first settles. Busy refuses the
                press without natively disabling the card the cook just pressed. */}
            <div className="flex flex-col gap-4 sm:flex-row">
                <OptionCard
                    title={conflict.optionServerTitle}
                    description={conflict.optionServerDescription}
                    onChoose={onKeepServer}
                    busy={isResolving}
                />
                <OptionCard
                    title={conflict.optionOverwriteTitle}
                    description={conflict.optionOverwriteDescription}
                    onChoose={onOverwrite}
                    disabled={view.overwriteBlocked}
                    busy={isResolving}
                />
                <OptionCard
                    title={conflict.optionMergeTitle}
                    description={conflict.optionMergeDescription}
                    onChoose={view.startMerge}
                    busy={isResolving}
                />
            </div>

            {/* Changed-only diff panel with per-row markers + legend (W7 Task 4 / X1). */}
            {diff.rows.length > 0 ? (
                <section aria-label={conflict.changedFieldsHeading} className="flex flex-col gap-3">
                    <h3 className="font-display text-heading-sm font-semibold text-ink">
                        {conflict.changedFieldsHeading}
                    </h3>
                    <ul className="flex flex-col gap-2">
                        {diff.rows.map((row) => (
                            <li
                                key={row.key}
                                className="flex flex-col gap-2 rounded-2xl bg-paper p-3 ring-1 ring-line-divider"
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        role="img"
                                        aria-label={conflictMarkerLabel(row.marker, conflict)}
                                        className="font-mono text-body-sm text-ink-muted"
                                    >
                                        {conflictMarkerGlyph(row.marker, conflict)}
                                    </span>
                                    <span className="text-caption uppercase tracking-wide text-ink-muted">
                                        {conflictRowLabel(row, conflict)}
                                    </span>
                                </div>
                                {row.base !== undefined && (
                                    <SideValue parts={conflictSideParts(row, 'base')}>
                                        <span className="text-body-sm text-ink-muted">
                                            {fillTemplate(conflict.wasValueLabel, { value: row.base })}
                                        </span>
                                    </SideValue>
                                )}
                                {/* Server value FIRST, then Yours (X7). */}
                                {(['theirs', 'mine'] as const).map((side) => (
                                    <SideValue key={side} parts={conflictSideParts(row, side)}>
                                        <span className="text-body-sm text-ink">
                                            {conflictOptionLabel(row, side, conflict)}
                                        </span>
                                    </SideValue>
                                ))}
                            </li>
                        ))}
                    </ul>
                    <ul
                        aria-label={conflict.legendHeading}
                        className="flex flex-wrap gap-3 text-caption text-ink-muted"
                    >
                        {LEGEND_MARKERS.map((marker) => (
                            <li key={marker}>
                                {fillTemplate(conflict.legendEntryTemplate, {
                                    glyph: conflictMarkerGlyph(marker, conflict),
                                    label: conflictMarkerLabel(marker, conflict),
                                })}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : (
                // Defensive — Task 2 already fast-paths a genuinely phantom-empty diff away from this view,
                // so this should not normally be reached; a blank panel is never an acceptable fallback.
                <p role="status" className="text-body-md text-ink-muted">
                    {conflict.noDifferencesMessage}
                </p>
            )}
        </section>
    );
};
