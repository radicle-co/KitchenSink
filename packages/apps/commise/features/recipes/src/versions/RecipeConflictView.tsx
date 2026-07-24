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
 * text/role, never colour alone) and Server-then-Yours values (X7), plus a legend. The merge panel itself
 * (Option C) is UNCHANGED from the pre-W7 shape — a per-field
 * radio chooser whose selections are the caller's own (`selections` in, `onSelectionsChange` out); this leaf
 * reports the current selections upward via `onMerge` and the caller composes + submits. Nothing is
 * auto-merged — every field's resolution is the user's explicit choice. Only the merge-panel-visible toggle
 * stays local (pure UI navigation, not data the machine needs).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useId, useState } from 'react';
import type { FC } from 'react';

import type { ConflictMarker } from './conflictDiff.js';
import { recipeVersionMessages } from './messages.js';
import {
    buildRecipeMergeFields,
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    fillTemplate,
    formatServerBanner,
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
 * together as one name.
 */
const OptionCard: FC<{
    readonly title: string;
    readonly description: string;
    readonly onChoose: () => void;
}> = ({ title, description, onChoose }) => {
    const descriptionId = useId();

    return (
        <button
            type="button"
            onClick={onChoose}
            aria-label={title}
            aria-describedby={descriptionId}
            className="flex flex-1 flex-col gap-1 rounded-2xl bg-card p-5 text-left shadow-sm ring-1 ring-border transition hover:bg-pearl"
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

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    server,
    diff,
    mineValues,
    theirsValues,
    selections,
    onSelectionsChange,
    onKeepServer,
    onOverwrite,
    onMerge,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    // Whether the merge panel is showing is pure UI navigation (not data the `useRecipeEditor` machine needs)
    // — it stays local. The per-field `selections` themselves are fully controlled by the caller.
    const [merging, setMerging] = useState(false);
    // Reading the clock is THIS component's own side effect (mirrors `HomeGreeting`'s split of "the caller
    // reads `new Date()`, the pure formatter only maps an instant to a string") — `formatServerBanner`/
    // `formatRelativeTimeAgo` stay pure and testable without freezing time.
    const now = new Date();

    const optionLabel = (side: string, value: string): string =>
        fillTemplate(conflict.mergeOptionLabel, { side, value });

    if (merging) {
        const fields = buildRecipeMergeFields(mineValues, theirsValues, conflict, locale);
        // Sparse per-field resolution: an absent field is the default ("mine"), matching `composeMergedRecipe`'s
        // own absent-key handling — so this reads the controlled `selections` prop with the same fallback.
        const sideOf = (key: string): MergeSide => selections[key] ?? 'mine';
        const choose = (key: string, side: MergeSide): void => onSelectionsChange({ ...selections, [key]: side });

        return (
            <section aria-label={conflict.mergeHeading} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">{conflict.mergeHeading}</h2>
                <p className="text-body-md text-slate">{conflict.mergeExplanation}</p>
                <div className="flex flex-col gap-3">
                    {fields.map((field) => (
                        <fieldset
                            key={field.key}
                            role="radiogroup"
                            aria-label={field.label}
                            className="flex flex-col gap-1 rounded-2xl bg-card p-4 ring-1 ring-border"
                        >
                            <legend className="text-caption uppercase tracking-wide text-slate">{field.label}</legend>
                            <label className="flex items-center gap-2 text-body-md text-charcoal">
                                <input
                                    type="radio"
                                    name={field.key}
                                    checked={sideOf(field.key) === 'mine'}
                                    onChange={() => choose(field.key, 'mine')}
                                />
                                {optionLabel(conflict.mergeMineLabel, field.mineValue)}
                            </label>
                            <label className="flex items-center gap-2 text-body-md text-charcoal">
                                <input
                                    type="radio"
                                    name={field.key}
                                    checked={sideOf(field.key) === 'theirs'}
                                    onChange={() => choose(field.key, 'theirs')}
                                />
                                {optionLabel(conflict.mergeServerLabel, field.theirsValue)}
                            </label>
                        </fieldset>
                    ))}
                </div>
                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={() => onMerge(selections)}
                        className="rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
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

            {/* Three A/B/C option cards (X2). */}
            <div className="flex flex-col gap-4 sm:flex-row">
                <OptionCard
                    title={conflict.optionServerTitle}
                    description={conflict.optionServerDescription}
                    onChoose={onKeepServer}
                />
                <OptionCard
                    title={conflict.optionOverwriteTitle}
                    description={conflict.optionOverwriteDescription}
                    onChoose={onOverwrite}
                />
                <OptionCard
                    title={conflict.optionMergeTitle}
                    description={conflict.optionMergeDescription}
                    onChoose={() => setMerging(true)}
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
