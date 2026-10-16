/**
 * @module @commise/features-account/danger/AccountEraseDialog — the WEB account-erasure dialog (CR-002 / U4b).
 *
 * A controlled `Dialog` built on `@radix-ui/react-dialog` — Radix owns focus-trapping, Escape-to-dismiss,
 * backdrop-click dismiss, and the `role="dialog"` + `aria-labelledby`/`aria-describedby` wiring from its
 * `Title`/`Description` parts, so this leaf only supplies the Commise visual language, the donate election,
 * and the phrase gate. `onOpenChange(false)` (Escape + backdrop) maps onto the same `onCancel` the explicit
 * Cancel button uses — one exit path, not two.
 *
 * The confirm action is enabled ONLY when {@link confirmsErasurePhrase} accepts the typed phrase and no
 * submit is in flight — the SAME predicate the native leaf uses, so the two platforms gate identically and
 * neither can enable a confirmation the server would `400`.
 *
 * The frame and type roles are the Close dialog's (`@commise/ui` `ConfirmDialog`): a `rounded-lg` `paper-overlay`
 * panel, a `section-title` title, a `body` / `inkMuted` description, the design-system `Input` and buttons. The
 * warning is not painted red end to end; a `dangerText` glyph stands beside it, and its words already say
 * "permanently" and "cannot be undone", so colour is never the only cue (`buildSpec.md` §10). It stays a Radix
 * `Dialog`, not the `AlertDialog` under `ConfirmDialog`, because it holds a form (the donate election and the phrase).
 *
 * @pattern Adapter over `@radix-ui/react-dialog` for the modal semantics, around a Specification —
 *     `confirmsErasurePhrase` — that is the whole gate on the destructive confirm.
 * @pattern The `recipesLoading` / `recipesError` booleans are DISPLAY DERIVATION of one donate-election slot, not a
 *     behaviour switch: every branch renders the same dialog with the same phrase gate and the same actions, so §11
 *     is satisfied without lifting them to the orchestration layer.
 */
import { Button, buttonSurfaceClass } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { FieldLabel, Input } from '@commise/ui/input';
import * as Dialog from '@radix-ui/react-dialog';
import type { FC } from 'react';

import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE, confirmsErasurePhrase } from '../erasure.js';
import { useMessages } from '@commise/i18n/react';
import { accountDangerMessages } from './messages.js';
import type { AccountEraseDialogProps } from './model.js';

export const AccountEraseDialog: FC<AccountEraseDialogProps> = ({
    open,
    donatableRecipes,
    recipesLoading = false,
    recipesError = false,
    selectedRecipeIds,
    onToggleRecipe,
    phrase,
    onPhraseChange,
    submitting = false,
    submitError = false,
    onConfirm,
    onCancel,
}) => {
    const { erase } = useMessages(accountDangerMessages);
    const canConfirm = confirmsErasurePhrase(phrase) && !submitting;
    const selected = new Set(selectedRecipeIds);

    return (
        // ⛔ No dismissal while `submitting`: the caller's erasure is still in flight, and dismissing unmounts the
        // caller that finishes it.
        <Dialog.Root open={open} onOpenChange={(next) => (next || submitting ? undefined : onCancel())}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
                <Dialog.Content className="@container/dialog fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg bg-paper-overlay p-6 shadow-lg">
                    <Dialog.Title className="text-section-title text-ink">{erase.title}</Dialog.Title>
                    <div className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-0.5 shrink-0 text-danger-text">
                            <Icon name="triangleAlert" size={20} />
                        </span>
                        <Dialog.Description className="text-body text-ink-muted">{erase.warning}</Dialog.Description>
                    </div>
                    <p className="text-body text-ink-muted">{erase.distinction}</p>

                    <section aria-labelledby="erase-donate-heading" className="flex flex-col gap-2">
                        <h3 id="erase-donate-heading" className="text-label text-ink">
                            {erase.donateHeading}
                        </h3>
                        <p className="text-meta text-ink-muted">{erase.donateHelp}</p>
                        {recipesLoading ? (
                            <p role="status" className="text-meta text-ink-muted">
                                {erase.recipesLoadingLabel}
                            </p>
                        ) : recipesError ? (
                            <p className="text-meta text-ink-muted">{erase.recipesError}</p>
                        ) : donatableRecipes.length === 0 ? (
                            <p className="text-meta text-ink-muted">{erase.donateEmpty}</p>
                        ) : (
                            <ul className="flex flex-col gap-1" role="list">
                                {donatableRecipes.map((recipe) => (
                                    <li key={recipe.id}>
                                        <label className="flex items-center gap-2 text-body text-ink">
                                            <input
                                                type="checkbox"
                                                checked={selected.has(recipe.id)}
                                                onChange={() => onToggleRecipe(recipe.id)}
                                            />
                                            {recipe.title}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <div className="flex flex-col gap-2">
                        <FieldLabel forId="erase-phrase" label={erase.phraseLabel} />
                        <p id="erase-phrase-prompt" className="text-meta text-ink-muted">
                            {erase.phrasePrompt.replace('{phrase}', ACCOUNT_ERASURE_CONFIRMATION_PHRASE)}
                        </p>
                        <Input
                            id="erase-phrase"
                            value={phrase}
                            onChangeText={onPhraseChange}
                            describedBy="erase-phrase-prompt"
                            autoComplete="off"
                        />
                    </div>

                    <div className="flex flex-col-reverse gap-3 @[25rem]/dialog:flex-row @[25rem]/dialog:justify-end">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                disabled={submitting}
                                className={`${buttonSurfaceClass('secondary')} w-full @[25rem]/dialog:w-auto`}
                            >
                                <Icon name="x" size={20} />
                                <span>{erase.cancel}</span>
                            </button>
                        </Dialog.Close>
                        <Button
                            variant="destructive"
                            tone="confirm"
                            icon="trash"
                            width="fill"
                            busy={submitting}
                            disabled={!canConfirm}
                            onPress={onConfirm}
                        >
                            {erase.confirm}
                        </Button>
                    </div>

                    {submitting && <p className="text-meta text-ink-muted">{erase.busyLabel}</p>}
                    {submitError && !submitting && (
                        <p role="alert" className="text-meta text-danger-text">
                            {erase.error}
                        </p>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
