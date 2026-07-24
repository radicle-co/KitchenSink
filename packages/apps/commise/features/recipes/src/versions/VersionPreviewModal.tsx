'use client';

/**
 * @module @commise/features-recipes — web version preview modal (W6 Task 3 / FR-007b).
 *
 * Presentational (pure props → JSX) render of the wireframe's "Version Preview Modal": a past version's
 * full content plus a "changed from current" summary. Built on the house **Radix `Dialog`**, MIRRORING
 * `PullUpdatesDialog.tsx` (W5 Task 10, C2 / FR-011) structurally and behaviourally — Radix owns the focus
 * trap, Escape-to-dismiss, and background inert; `open` is driven entirely by the caller and `onOpenChange`
 * maps every Radix close path onto the same `onCancel` the explicit "Keep current version" control uses, so
 * there is exactly ONE exit path, not two.
 *
 * Focus-return is handled explicitly, NOT left to Radix's default, for the SAME reason `PullUpdatesDialog`
 * does it: this dialog is opened by a sibling control (the version list's "Preview" row action, W6 Task 5),
 * not an owned `Dialog.Trigger`, so Radix's built-in `onCloseAutoFocus` (which only restores an OWNED
 * trigger — see `DialogContentModal` in `@radix-ui/react-dialog`) would silently focus nothing.
 * `triggerRef` captures `document.activeElement` at the render where `open` flips true — BEFORE
 * `Dialog.Content` (and its autofocus-on-mount) ever commits — and `onCloseAutoFocus` restores it,
 * `preventDefault()`ing Radix's own no-op default.
 *
 * A discriminated three-way state (mutually exclusive, matching {@link VersionPreviewModalProps}'s JSDoc):
 * (1) a `role="status"` progress affordance while `isLoading`, or before any `version` has arrived; (2) a
 * `role="alert"` for a failed fetch — deliberately NOT a dead end: "Keep current version" still closes the
 * modal, so the composing container (W6 Task 5) can retry; (3) the loaded `version` — the snapshot's title,
 * description, servings, prep/cook/total time, and ingredient lines (calorie chip only when the line carries
 * a `userCalories` override — never fabricated), plus the "Changed from current" summary when
 * `diffFromCurrent` was supplied, and the count-templated Restore action.
 */
import { useMessages } from '@commise/i18n/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type FC } from 'react';

import { formatDurationMinutes } from '../list/model.js';
import { recipeVersionMessages } from './messages.js';
import {
    changedFromCurrentCounts,
    fillTemplate,
    toVersionPreviewIngredientLines,
    type VersionPreviewModalProps,
} from './model.js';

export const VersionPreviewModal: FC<VersionPreviewModalProps> = ({
    open,
    version,
    isLoading,
    error,
    diffFromCurrent,
    onCancel,
    onRestore,
    isRestoring = false,
    locale,
}) => {
    const { preview, conflict } = useMessages(recipeVersionMessages);

    // Capture whatever had focus right before this dialog opened, during render (not an effect) — see
    // module docs; guarded on the false→true edge so it isn't re-captured on every re-render while open.
    const triggerRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);

    if (open && !wasOpenRef.current) {
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    wasOpenRef.current = open;

    // Never trust an in-flight fetch: loading always wins, and no version at all reads as "still loading"
    // rather than risking a blank/misleading dialog before the first fetch resolves.
    const showLoading = isLoading || (version === undefined && error !== true);
    const showError = !showLoading && error === true;
    const showContent = !showLoading && !showError && version !== undefined;

    const title =
        version !== undefined
            ? fillTemplate(preview.title, { version: version.versionNumber, title: version.snapshot.title })
            : preview.titleLoading;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40" />
                <Dialog.Content
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        triggerRef.current?.focus();
                    }}
                    className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl bg-card p-6 shadow-lg"
                >
                    <Dialog.Title className="font-display text-heading-lg font-semibold text-charcoal">
                        {title}
                    </Dialog.Title>

                    {showLoading && (
                        <p role="status" aria-label={preview.loading} className="text-body-md text-slate">
                            {preview.loading}
                        </p>
                    )}

                    {showError && (
                        <p role="alert" className="text-body-md text-error">
                            {preview.error}
                        </p>
                    )}

                    {showContent && version !== undefined && (
                        <div className="flex flex-col gap-4">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-md text-charcoal">
                                <dt className="font-medium text-slate">{conflict.titleLabel}</dt>
                                <dd>{version.snapshot.title}</dd>
                                <dt className="font-medium text-slate">{conflict.descriptionLabel}</dt>
                                <dd>{version.snapshot.description}</dd>
                                <dt className="font-medium text-slate">{conflict.servingsLabel}</dt>
                                <dd>{version.snapshot.servings}</dd>
                                <dt className="font-medium text-slate">{conflict.prepLabel}</dt>
                                <dd>{formatDurationMinutes(version.snapshot.prepTimeMinutes, conflict.minutes)}</dd>
                                <dt className="font-medium text-slate">{conflict.cookLabel}</dt>
                                <dd>{formatDurationMinutes(version.snapshot.cookTimeMinutes, conflict.minutes)}</dd>
                                <dt className="font-medium text-slate">{conflict.totalLabel}</dt>
                                <dd>
                                    {formatDurationMinutes(
                                        version.snapshot.prepTimeMinutes + version.snapshot.cookTimeMinutes,
                                        conflict.minutes,
                                    )}
                                </dd>
                            </dl>

                            <div className="flex flex-col gap-2">
                                <h3 className="font-display text-body-md font-semibold text-charcoal">
                                    {fillTemplate(preview.ingredientsHeading, { version: version.versionNumber })}
                                </h3>
                                <ul className="flex flex-col divide-y divide-border rounded-2xl bg-pearl p-2">
                                    {toVersionPreviewIngredientLines(version.snapshot.ingredients, preview, locale).map(
                                        (line) => (
                                            <li
                                                key={line.key}
                                                className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm text-charcoal"
                                            >
                                                <span>{line.text}</span>
                                                {line.calories !== undefined && (
                                                    <span className="text-slate">{line.calories}</span>
                                                )}
                                            </li>
                                        ),
                                    )}
                                </ul>
                            </div>

                            {diffFromCurrent !== undefined && (
                                <p className="text-body-sm italic text-slate">
                                    {fillTemplate(
                                        preview.changedFromCurrent,
                                        changedFromCurrentCounts(diffFromCurrent),
                                    )}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3">
                        <Dialog.Close className="rounded-full px-4 py-2 text-body-sm font-medium text-slate transition hover:bg-pearl">
                            {preview.keepCurrent}
                        </Dialog.Close>
                        {showContent && version !== undefined && (
                            <button
                                type="button"
                                onClick={() => onRestore(version.versionNumber)}
                                disabled={isRestoring}
                                aria-busy={isRestoring}
                                className="rounded-full bg-seafoam px-5 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isRestoring ? preview.restoringThis : preview.restoreThis}
                            </button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
