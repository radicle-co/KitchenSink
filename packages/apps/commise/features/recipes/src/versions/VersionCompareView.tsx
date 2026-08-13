'use client';

/**
 * @module @commise/features-recipes — web two-version compare panel (W6 Task 4 / FR-007b, FR-007c).
 *
 * Presentational (pure props → JSX) render of the wireframe's "Compare Versions" right sidebar: a Diff
 * Summary (Added/Removed/Modified rollup) plus a CHANGED-ONLY field-by-field A/B display. Built on the house
 * **Radix `Dialog`**, MIRRORING `VersionPreviewModal.tsx` (W6 Task 3) structurally and behaviourally — Radix
 * owns the focus trap, Escape-to-dismiss, and background inert; `open` is driven entirely by the caller and
 * `onOpenChange` maps every Radix close path onto the same `onClose` the explicit close control uses, so
 * there is exactly ONE exit path. `Dialog.Content` is styled as a right-anchored panel (`inset-y-0 right-0`)
 * rather than centered, matching the wireframe's sidebar placement while keeping Radix's dismissal/focus
 * machinery. Focus-return is handled explicitly, for the SAME reason `VersionPreviewModal` does it: this
 * panel is opened by a sibling control (the version list's "Compare" action, W6 Task 5), not an owned
 * `Dialog.Trigger`.
 *
 * A three-way state (`compareViewState`, discriminated, matching
 * `VersionCompareViewProps`'s JSDoc): (1) `'selecting'` — `open` but fewer than
 * two versions (or no `diff`) supplied yet, showing "Select two versions to compare." rather than a broken
 * partial render (the two-version SELECTION UI itself lives in the composing container, Task 5); (2)
 * `'unchanged'` — both versions supplied but their snapshots are identical, showing the (all-zero) Diff
 * Summary plus a "no changes" message instead of field rows; (3) `'changed'` — the Diff Summary plus
 * ONLY `diff.changedFields`, each as an A/B row. `steps`/`ingredients` rows show a COUNT ONLY by default
 * (never a per-line explosion — see `buildCompareFieldRows`'s module docs for the Task 1 reorder sanity
 * note); their own Added/Removed/Modified tally is opt-in detail behind "Show full diff", a single toggle
 * shared by every collection row (local UI state — pure navigation, not data the caller needs, matching
 * `RecipeConflictView`'s merge-panel-visible precedent).
 */
import { useMessages } from '@commise/i18n/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState, type FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import {
    buildCompareFieldRows,
    compareViewState,
    fillTemplate,
    formatCollectionTally,
    type VersionCompareViewProps,
} from './model.js';

export const VersionCompareView: FC<VersionCompareViewProps> = ({
    open,
    versionA,
    versionB,
    diff,
    onClose,
    locale,
}) => {
    const { compare, conflict, versionList } = useMessages(recipeVersionMessages);
    const [showFullDiff, setShowFullDiff] = useState(false);

    // Capture whatever had focus right before this panel opened, during render (not an effect) — see module
    // docs; guarded on the false→true edge so it isn't re-captured on every re-render while open.
    const triggerRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);

    if (open && !wasOpenRef.current) {
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    wasOpenRef.current = open;

    const state = compareViewState(versionA, versionB, diff);
    const heading =
        state !== 'selecting' && versionA !== undefined && versionB !== undefined
            ? fillTemplate(compare.title, { versionA: versionA.versionNumber, versionB: versionB.versionNumber })
            : compare.selectTwoVersions;
    const rows =
        diff !== undefined && versionA !== undefined && versionB !== undefined
            ? buildCompareFieldRows(diff, versionA, versionB, conflict, locale)
            : [];
    const hasCollectionRow = rows.some((row) => row.tally !== undefined);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40" />
                <Dialog.Content
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                    className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-card p-6 shadow-lg"
                >
                    <div className="flex items-center justify-between gap-3">
                        <Dialog.Title className="font-display text-heading-lg font-semibold text-charcoal">
                            {heading}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={compare.close}
                            className="rounded-full p-1.5 text-slate transition hover:bg-pearl"
                        >
                            ×
                        </Dialog.Close>
                    </div>

                    {state !== 'selecting' && diff !== undefined && (
                        <>
                            <section
                                aria-label={compare.diffSummaryHeading}
                                className="flex flex-col gap-2 rounded-2xl bg-pearl p-4"
                            >
                                <h3 className="font-display text-body-md font-semibold text-charcoal">
                                    {compare.diffSummaryHeading}
                                </h3>
                                <dl className="flex flex-col gap-1 text-body-sm text-charcoal">
                                    <div>{fillTemplate(compare.added, { count: diff.summary.added })}</div>
                                    <div>{fillTemplate(compare.removed, { count: diff.summary.removed })}</div>
                                    <div>{fillTemplate(compare.modified, { count: diff.summary.modified })}</div>
                                </dl>
                            </section>

                            {state === 'unchanged' ? (
                                <p className="text-body-md text-slate">{compare.noChanges}</p>
                            ) : (
                                versionA !== undefined &&
                                versionB !== undefined && (
                                    <div className="flex flex-col gap-3">
                                        <div className="grid grid-cols-1 gap-3 text-caption font-medium uppercase tracking-wide text-slate md:grid-cols-2">
                                            <span>
                                                {fillTemplate(versionList.versionLabel, {
                                                    version: versionB.versionNumber,
                                                })}
                                            </span>
                                            <span>
                                                {fillTemplate(versionList.versionLabel, {
                                                    version: versionA.versionNumber,
                                                })}
                                            </span>
                                        </div>
                                        <ul className="flex flex-col gap-3">
                                            {rows.map((row) => (
                                                <li
                                                    key={row.key}
                                                    className="flex flex-col gap-1 rounded-2xl bg-pearl p-3"
                                                >
                                                    <span className="text-caption font-medium uppercase tracking-wide text-slate">
                                                        {row.label}
                                                    </span>
                                                    <div className="grid grid-cols-1 gap-3 text-body-sm text-charcoal md:grid-cols-2">
                                                        <span>{row.valueB}</span>
                                                        <span>{row.valueA}</span>
                                                    </div>
                                                    {row.tally !== undefined && showFullDiff && (
                                                        <span className="text-caption text-slate">
                                                            {formatCollectionTally(row.tally, compare)}
                                                        </span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                        {hasCollectionRow && (
                                            <button
                                                type="button"
                                                onClick={() => setShowFullDiff((current) => !current)}
                                                className="self-start rounded-full px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/10"
                                            >
                                                {showFullDiff ? compare.hideFullDiff : compare.showFullDiff}
                                            </button>
                                        )}
                                    </div>
                                )
                            )}
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
