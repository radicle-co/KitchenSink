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
 * @pattern Adapter over `@radix-ui/react-dialog` for the modal semantics, around a Specification —
 *     `confirmsErasurePhrase` — that is the whole gate on the destructive confirm.
 * @pattern The `recipesLoading` / `recipesError` booleans are DISPLAY DERIVATION of one donate-election slot, not a
 *     behaviour switch: every branch renders the same dialog with the same phrase gate and the same actions, so §11
 *     is satisfied without lifting them to the orchestration layer.
 */
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
        <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl bg-paper p-6 shadow-lg">
                    <Dialog.Title className="font-display text-heading-lg font-semibold text-ink">
                        {erase.title}
                    </Dialog.Title>
                    <Dialog.Description className="text-body-md leading-relaxed text-danger-text">
                        {erase.warning}
                    </Dialog.Description>
                    <p className="text-body-sm leading-relaxed text-ink-muted">{erase.distinction}</p>

                    <section aria-labelledby="erase-donate-heading" className="flex flex-col gap-2">
                        <h3 id="erase-donate-heading" className="text-body-md font-semibold text-ink">
                            {erase.donateHeading}
                        </h3>
                        <p className="text-body-sm leading-relaxed text-ink-muted">{erase.donateHelp}</p>
                        {recipesLoading ? (
                            <p role="status" className="text-body-sm text-ink-muted">
                                {erase.recipesLoadingLabel}
                            </p>
                        ) : recipesError ? (
                            <p className="text-body-sm text-ink-muted">{erase.recipesError}</p>
                        ) : donatableRecipes.length === 0 ? (
                            <p className="text-body-sm text-ink-muted">{erase.donateEmpty}</p>
                        ) : (
                            <ul className="flex flex-col gap-1" role="list">
                                {donatableRecipes.map((recipe) => (
                                    <li key={recipe.id}>
                                        <label className="flex items-center gap-2 text-body-sm text-ink">
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

                    <div className="flex flex-col gap-1">
                        <label htmlFor="erase-phrase" className="text-body-sm font-medium text-ink">
                            {erase.phraseLabel}
                        </label>
                        <p id="erase-phrase-prompt" className="text-body-sm text-ink-muted">
                            {erase.phrasePrompt.replace('{phrase}', ACCOUNT_ERASURE_CONFIRMATION_PHRASE)}
                        </p>
                        <input
                            id="erase-phrase"
                            type="text"
                            value={phrase}
                            onChange={(event) => onPhraseChange(event.target.value)}
                            aria-describedby="erase-phrase-prompt"
                            autoComplete="off"
                            className="rounded-lg border border-line-control px-3 py-2 text-body-md text-ink"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                className="rounded-full px-4 py-2 text-body-sm font-medium text-ink-muted transition hover:bg-ink/6"
                            >
                                {erase.cancel}
                            </button>
                        </Dialog.Close>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={!canConfirm}
                            aria-busy={submitting || undefined}
                            className="rounded-full bg-danger px-5 py-2 text-body-sm font-semibold text-on-action shadow-sm transition hover:opacity-90 disabled:opacity-50"
                        >
                            {erase.confirm}
                        </button>
                    </div>

                    {submitting && <p className="text-body-sm text-ink-muted">{erase.busyLabel}</p>}
                    {submitError && !submitting && (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {erase.error}
                        </p>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
