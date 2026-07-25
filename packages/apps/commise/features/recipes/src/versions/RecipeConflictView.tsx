'use client';

/**
 * @module @commise/features-recipes — web concurrent-edit conflict view (T070 / C-005 / W7 building block).
 *
 * `'use client'` is required: this leaf calls `useState` for the field-by-field merge mode, and it is
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
 * per row, Server FIRST then Yours (X7), reusing {@link import('./model.js').conflictRowLabel} so a merge
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
 * re-render of the SAME one) arrives on this component instance, so neither can leak across conflicts.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, FC } from 'react';

import type { ConflictMarker } from './conflictDiff.js';
import { recipeVersionMessages } from './messages.js';
import {
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    fillTemplate,
    formatMergeSummary,
    formatServerBanner,
    isConflictBaseStale,
    type MergeSide,
    type RecipeConflictViewProps,
} from './model.js';

/** The three markers, in the order the legend explains them (matching the wireframe's own `[=] [→] [!!]`
 *  order). */
const LEGEND_MARKERS: readonly ConflictMarker[] = ['unchanged', 'changed', 'conflict'];

/**
 * One A/B/C option card — a title, a description, and the choice it fires. `aria-label` pins the button's
 * accessible NAME to the title alone (its computed-from-content name would otherwise run the description
 * text on too, e.g. "Keep server version Discard your local changes…"); `aria-describedby` still attaches
 * the description as the button's accessible DESCRIPTION, so assistive tech reads both, just not run
 * together as one name. `disabled` (W7 Task 5 / X6) is the stale-base confirm gate on Option B (Overwrite)
 * — Option A and C are never gated this way (see the module doc).
 */
const OptionCard: FC<{
    readonly title: string;
    readonly description: string;
    readonly onChoose: () => void;
    readonly disabled?: boolean;
}> = ({ title, description, onChoose, disabled = false }) => {
    const descriptionId = useId();

    return (
        <button
            type="button"
            onClick={onChoose}
            disabled={disabled}
            aria-label={title}
            aria-describedby={descriptionId}
            className="flex flex-1 flex-col gap-1 rounded-2xl bg-card p-5 text-left shadow-sm ring-1 ring-border transition hover:bg-pearl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
        >
            <span aria-hidden="true" className="font-display text-body-lg font-semibold text-charcoal">
                {title}
            </span>
            <span id={descriptionId} className="text-body-sm text-slate">
                {description}
            </span>
        </button>
    );
};

/**
 * The stale-base warning + explicit confirm checkbox (W7 Task 5 / X6) — shared, unchanged markup between the
 * options view (gates Overwrite) and the merge panel (gates Save merged version), so the two can never drift
 * on wording or behavior. `role="alert"` (mirrors `RecipeDeleteDialog`'s own alert-role warning surfaces).
 */
const StaleBaseWarning: FC<{
    readonly warning: string;
    readonly confirmLabel: string;
    readonly confirmed: boolean;
    readonly onConfirmedChange: (confirmed: boolean) => void;
}> = ({ warning, confirmLabel, confirmed, onConfirmedChange }) => (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-warning/15 p-4 ring-1 ring-warning">
        <p className="text-body-sm text-charcoal">{warning}</p>
        <label className="flex items-center gap-2 text-body-sm font-medium text-charcoal">
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
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    // Whether the merge panel is showing is pure UI navigation (not data the `useRecipeEditor` machine needs)
    // — it stays local. So is the stale-base confirm checkbox (W7 Task 5 / X6) — a fresh acknowledgment for
    // THIS conflict, not data the machine composes with. The per-field `selections` themselves are fully
    // controlled by the caller.
    const [merging, setMerging] = useState(false);
    const [staleConfirmed, setStaleConfirmed] = useState(false);
    // A NEW conflict (same component instance, new props — e.g. a retried Overwrite that 409'd again) must
    // NOT inherit the PRIOR conflict's local UI state: without this reset, a confirmed-but-still-stale
    // checkbox would silently authorize Overwrite/Save-merged on a conflict the user never actually
    // confirmed (X6 robustness gap), and the merge panel would stay open showing the STALE conflict's rows.
    // `server.versionNumber` is this conflict's stable identity token (a fresh 409 always carries the
    // server's CURRENT version, so two DIFFERENT conflicts can never share one).
    useEffect(() => {
        setStaleConfirmed(false);
        setMerging(false);
    }, [server.versionNumber]);
    // Reading the clock is THIS component's own side effect (mirrors `HomeGreeting`'s split of "the caller
    // reads `new Date()`, the pure formatter only maps an instant to a string") — `formatServerBanner`/
    // `formatRelativeTimeAgo` stay pure and testable without freezing time.
    const now = new Date();

    const optionLabel = (side: string, value: string): string =>
        fillTemplate(conflict.mergeOptionLabel, { side, value });

    const isStale = isConflictBaseStale(base, versionsBehind);
    const hasSelection = Object.keys(selections).length > 0;
    const staleWarning = isStale ? (
        <StaleBaseWarning
            warning={conflict.staleBaseWarning}
            confirmLabel={conflict.staleBaseConfirmLabel}
            confirmed={staleConfirmed}
            onConfirmedChange={setStaleConfirmed}
        />
    ) : null;

    if (merging) {
        // No default side: an absent key renders NEITHER radio checked, so the running summary — and the
        // selection gate below — reflect only the user's EXPLICIT picks (an absent key still composes to
        // "mine" downstream, in `composeConflictMerge` — this is a display/gating distinction, not a data one).
        const sideOf = (key: string): MergeSide | undefined => selections[key];
        const choose = (key: string, side: MergeSide): void => onSelectionsChange({ ...selections, [key]: side });
        // `isResolving` (concurrency/double-submit fix) is combined with, not a replacement for, the existing
        // selection + stale-base gates — any one of the three blocks the submit.
        const mergeDisabled = !hasSelection || (isStale && !staleConfirmed) || isResolving;

        return (
            <section aria-label={conflict.mergeHeading} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">{conflict.mergeHeading}</h2>
                <p className="text-body-md text-slate">{conflict.mergeExplanation}</p>
                {staleWarning}
                <div className="flex flex-col gap-3">
                    {diff.rows.map((row) => {
                        const label = conflictRowLabel(row, conflict);
                        const current = sideOf(row.key);

                        return (
                            <fieldset
                                key={row.key}
                                role="radiogroup"
                                aria-label={label}
                                className="flex flex-col gap-1 rounded-2xl bg-card p-4 ring-1 ring-border"
                            >
                                <legend className="text-caption uppercase tracking-wide text-slate">{label}</legend>
                                {/* Server FIRST, then Yours (X7). */}
                                <label className="flex items-center gap-2 text-body-md text-charcoal">
                                    <input
                                        type="radio"
                                        name={row.key}
                                        checked={current === 'theirs'}
                                        onChange={() => choose(row.key, 'theirs')}
                                    />
                                    {optionLabel(conflict.mergeServerLabel, row.theirs)}
                                </label>
                                <label className="flex items-center gap-2 text-body-md text-charcoal">
                                    <input
                                        type="radio"
                                        name={row.key}
                                        checked={current === 'mine'}
                                        onChange={() => choose(row.key, 'mine')}
                                    />
                                    {optionLabel(conflict.mergeMineLabel, row.mine)}
                                </label>
                            </fieldset>
                        );
                    })}
                </div>
                <p aria-live="polite" className="text-body-sm font-medium text-charcoal">
                    {formatMergeSummary(selections, conflict, locale)}
                </p>
                {!hasSelection && (
                    <p role="status" className="text-body-sm text-slate">
                        {conflict.mergeNoSelectionHint}
                    </p>
                )}
                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={() => onMerge(selections)}
                        disabled={mergeDisabled}
                        className="rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-seafoam"
                    >
                        {conflict.mergeSubmit}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onSelectionsChange({});
                            setMerging(false);
                        }}
                        className="rounded-full px-5 py-2 text-body-sm font-semibold text-charcoal ring-1 ring-border transition hover:bg-card"
                    >
                        {conflict.mergeBack}
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section aria-label={conflict.heading} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
            <h2 className="font-display text-heading-lg font-semibold text-charcoal">{conflict.heading}</h2>
            <p className="text-body-md text-slate">{conflict.explanation}</p>

            {/* Per-side banner (X3) — server is ALWAYS first (X7). */}
            <div className="flex flex-col gap-1 rounded-2xl bg-card p-4 ring-1 ring-border">
                <p className="text-body-md text-charcoal">{formatServerBanner(server, now, conflict, locale)}</p>
                <p className="text-body-md text-charcoal">{conflict.mineBanner}</p>
            </div>

            {/* Stale-base warning (W7 Task 5 / X6) — gates Overwrite below. */}
            {staleWarning}

            {/* Three A/B/C option cards (X2). `isResolving` (concurrency/double-submit fix) disables ALL
                three — combined with, not replacing, Overwrite's existing stale-base gate — while a resolve
                is in flight, so a rapid double-click cannot fire a second resolve before the first settles. */}
            <div className="flex flex-col gap-4 sm:flex-row">
                <OptionCard
                    title={conflict.optionServerTitle}
                    description={conflict.optionServerDescription}
                    onChoose={onKeepServer}
                    disabled={isResolving}
                />
                <OptionCard
                    title={conflict.optionOverwriteTitle}
                    description={conflict.optionOverwriteDescription}
                    onChoose={onOverwrite}
                    disabled={isResolving || (isStale && !staleConfirmed)}
                />
                <OptionCard
                    title={conflict.optionMergeTitle}
                    description={conflict.optionMergeDescription}
                    onChoose={() => setMerging(true)}
                    disabled={isResolving}
                />
            </div>

            {/* Changed-only diff panel with per-row markers + legend (W7 Task 4 / X1). */}
            {diff.rows.length > 0 ? (
                <section aria-label={conflict.changedFieldsHeading} className="flex flex-col gap-3">
                    <h3 className="font-display text-heading-sm font-semibold text-charcoal">
                        {conflict.changedFieldsHeading}
                    </h3>
                    <ul className="flex flex-col gap-2">
                        {diff.rows.map((row) => (
                            <li
                                key={row.key}
                                className="flex flex-col gap-1 rounded-2xl bg-card p-3 ring-1 ring-border"
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        role="img"
                                        aria-label={conflictMarkerLabel(row.marker, conflict)}
                                        className="font-mono text-body-sm text-slate"
                                    >
                                        {conflictMarkerGlyph(row.marker, conflict)}
                                    </span>
                                    <span className="text-caption uppercase tracking-wide text-slate">
                                        {conflictRowLabel(row, conflict)}
                                    </span>
                                </div>
                                {row.base !== undefined && (
                                    <p className="text-body-sm text-slate">
                                        {fillTemplate(conflict.wasValueLabel, { value: row.base })}
                                    </p>
                                )}
                                {/* Server value FIRST, then Yours (X7). */}
                                <p className="text-body-sm text-charcoal">
                                    {optionLabel(conflict.mergeServerLabel, row.theirs)}
                                </p>
                                <p className="text-body-sm text-charcoal">
                                    {optionLabel(conflict.mergeMineLabel, row.mine)}
                                </p>
                            </li>
                        ))}
                    </ul>
                    <ul aria-label={conflict.legendHeading} className="flex flex-wrap gap-3 text-caption text-slate">
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
                <p role="status" className="text-body-md text-slate">
                    {conflict.noDifferencesMessage}
                </p>
            )}
        </section>
    );
};
