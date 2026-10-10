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
 * (1) a `role="status"` progress affordance while `isLoading`; (2) a `role="alert"` for a failed lookup —
 * either an explicit `error` or, per B21, nothing pending and still no `version` — deliberately NOT a dead
 * end: "Keep current version" still closes the modal, so the composing container (W6 Task 5) can retry;
 * (3) the loaded `version` — the snapshot's title,
 * description, servings, prep/cook/total time, and ingredient lines (calorie chip only when the line carries
 * a `userCalories` override — never fabricated), plus the "Changed from current" summary when
 * `diffFromCurrent` was supplied, and the count-templated Restore action.
 *
 * @pattern Adapter over the house Radix `Dialog`, mirroring `PullUpdatesDialog.tsx` structurally and behaviourally —
 *     `open` is the caller's and this leaf stays a controlled `props → JSX` render.
 */
import { Button, buttonSurfaceClass } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { useReturnFocusOnClose } from '@commise/ui/dialog-focus';
import { Icon } from '@commise/ui/icon';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import * as Dialog from '@radix-ui/react-dialog';
import { type FC } from 'react';

import { formatDurationMinutes } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { recipeVersionMessages } from './messages.js';
import { fillTemplate } from '../list/model.js';
import { previewRestoreErrorMessage, unrestorablePositionsFor } from './history.js';
import { type VersionPreviewModalProps, formatChangedFromCurrent, toVersionPreviewIngredientLines } from './preview.js';

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
    restoreError,
}) => {
    const { preview, conflict, versionList } = useMessages(recipeVersionMessages);
    const { ingredientLineName } = useMessages(recipeMessages);

    // Snapshot whatever had focus right before this dialog opened, and restore it on close — see module docs
    // and `@commise/ui/dialog-focus`; the false→true edge guard lives inside the hook.
    const onCloseAutoFocus = useReturnFocusOnClose(open);

    // Loading always wins — a fetch that is genuinely in flight must not read as broken on first paint. Once
    // NOTHING is pending, though, having no version to show IS a failure (B21): this used to read "still
    // loading" whenever `version` was absent, so a caller that had settled with nothing — the shape a preview
    // target missing from the loaded history produces — was stranded on a spinner the modal had no state to
    // escape into. `error` is now one of TWO ways to reach the failure affordance, not the only one.
    const showLoading = isLoading;
    const showError = !showLoading && (error === true || version === undefined);
    const showContent = !showLoading && !showError && version !== undefined;
    const restoreErrorText =
        version === undefined
            ? undefined
            : previewRestoreErrorMessage(restoreError, version.versionNumber, versionList, preview);

    const title =
        version !== undefined
            ? fillTemplate(preview.title, { version: version.versionNumber, title: version.snapshot.title })
            : preview.titleLoading;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
                <Dialog.Content
                    onCloseAutoFocus={onCloseAutoFocus}
                    className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl bg-paper p-6 shadow-lg md:max-w-2xl"
                >
                    <Dialog.Title className="font-display text-heading-lg font-semibold text-ink">{title}</Dialog.Title>

                    {showLoading && (
                        <p role="status" aria-label={preview.loading} className="text-body-md text-ink-muted">
                            {preview.loading}
                        </p>
                    )}

                    {showError && (
                        <p role="alert" className="text-body-md text-danger-text">
                            {preview.error}
                        </p>
                    )}

                    {/* A failed restore of THIS version, shown where the cook pressed Restore rather than only in
                        the list behind the dialog (`namelessLineCopy.md` §5). */}
                    {restoreErrorText !== undefined && (
                        <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-body-sm text-danger-text">
                            {restoreErrorText}
                        </p>
                    )}

                    {showContent && version !== undefined && (
                        <div className="flex flex-col gap-4">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-md text-ink">
                                <dt className="font-medium text-ink-muted">{conflict.titleLabel}</dt>
                                <dd>{version.snapshot.title}</dd>
                                <dt className="font-medium text-ink-muted">{conflict.descriptionLabel}</dt>
                                <dd>{version.snapshot.description}</dd>
                                <dt className="font-medium text-ink-muted">{conflict.servingsLabel}</dt>
                                <dd>{version.snapshot.servings}</dd>
                                <dt className="font-medium text-ink-muted">{conflict.prepLabel}</dt>
                                <dd>{formatDurationMinutes(version.snapshot.prepTimeMinutes, conflict.minutes)}</dd>
                                <dt className="font-medium text-ink-muted">{conflict.cookLabel}</dt>
                                <dd>{formatDurationMinutes(version.snapshot.cookTimeMinutes, conflict.minutes)}</dd>
                                <dt className="font-medium text-ink-muted">{conflict.totalLabel}</dt>
                                <dd>
                                    {formatDurationMinutes(
                                        version.snapshot.prepTimeMinutes + version.snapshot.cookTimeMinutes,
                                        conflict.minutes,
                                    )}
                                </dd>
                            </dl>

                            <div className="flex flex-col gap-2">
                                <h3 className="font-display text-body-md font-semibold text-ink">
                                    {fillTemplate(preview.ingredientsHeading, { version: version.versionNumber })}
                                </h3>
                                <ul className="flex flex-col divide-y divide-line-divider rounded-2xl bg-surface-muted p-2">
                                    {toVersionPreviewIngredientLines(
                                        version.snapshot.ingredients,
                                        preview,
                                        locale,
                                        ingredientLineName,
                                        unrestorablePositionsFor(restoreError, version.versionNumber),
                                    ).map((line) => (
                                        <li
                                            key={line.key}
                                            className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm text-ink"
                                        >
                                            {/* The line text yields the width (and breaks); the calorie
                                                    chip never shrinks. Parity with the native leaf's
                                                    `flexShrink` pair — see `VersionPreviewModal.native.tsx`. */}
                                            <span className="min-w-0 break-words">
                                                {line.text}
                                                {/* Curated U15 (§S1): a variant-bound line's dotted line, on a
                                                    line of its own under the line it belongs to. */}
                                                {line.variantParts !== undefined && (
                                                    <span className="mt-1 block">
                                                        <VariantPartsLine parts={line.variantParts} tone="secondary" />
                                                    </span>
                                                )}
                                                {/* Words, never colour alone: the refused restore named this
                                                        line. Plain text in the line, so it is read with it, and
                                                        last, because it is about the whole line, details too. */}
                                                {line.cannotRestore !== undefined && (
                                                    <>
                                                        {' '}
                                                        <span className="font-medium text-danger-text">
                                                            {line.cannotRestore}
                                                        </span>
                                                    </>
                                                )}
                                            </span>
                                            {line.calories !== undefined && (
                                                <span className="shrink-0 text-ink-muted">{line.calories}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {diffFromCurrent !== undefined && (
                                <p className="text-body-sm italic text-ink-muted">
                                    {formatChangedFromCurrent(diffFromCurrent, preview, conflict, locale)}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3">
                        {/* A Radix slot, so it wears the Button surface rather than being one: the ConfirmDialog's Keep, `x` included. */}
                        <Dialog.Close className={buttonSurfaceClass('secondary')}>
                            <Icon name="x" size={20} />
                            {preview.keepCurrent}
                        </Dialog.Close>
                        {showContent && version !== undefined && (
                            <Button
                                icon="rotateCcw"
                                busy={isRestoring}
                                onPress={() => onRestore(version.versionNumber)}
                            >
                                {isRestoring ? preview.restoringThis : preview.restoreThis}
                            </Button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
