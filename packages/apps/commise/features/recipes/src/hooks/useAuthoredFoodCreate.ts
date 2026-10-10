/**
 * @module @commise/features-recipes/hooks — the create-my-own-food form's controller (`docs/design/rowEditorBlueprint.md`
 * decision 2): the U16 form, hosted by the row editor.
 *
 * It owns the form and the create request, which goes to FOOD (`POST /api/v1/foods/authored`, plan 002 S5.5). Putting
 * the food on the line is not its job: it emits a `catalogFood` pick of the food into the host's commit port
 * (`useLineCommit`), which chooses the route (`commitRouteFor`). So a food created from a stored line on the edit form
 * re-points that line through the rebind command, and one created from the trailing row is admitted and appended.
 *
 * The pick is the same whether food created the food or answered with the cook's existing one (the per-author
 * duplicate, U16). Which of the two happened is a fact of this form, so it travels BESIDE the pick, as the
 * {@link AuthoredFoodOutcome} the port records with the commit.
 *
 * The form stays busy until the food is on the line, and stays open with its draft when the line did not take it.
 *
 * @pattern Headless hook — the form's phase lives here and a leaf renders {@link AuthoredFoodCreateState}
 */
import { useCreateAuthoredFood } from '@kitchensink/food-service-client/hooks';
import { useState } from 'react';

import {
    authoredFoodCreateStateOf,
    draftFromQuery,
    validateAuthoredFoodDraft,
    withAuthoredFoodField,
    type AuthoredFoodCreatePhase,
    type AuthoredFoodCreateState,
    type AuthoredFoodDraft,
} from './authoredFoodCreate.model.js';
import type { IngredientPick, LineCommitOutcome, LineCommitTarget } from './lineCommit.js';

/** Whether the food on the line is one food just made, or the cook's existing food of that name. */
export type AuthoredFoodOutcome = 'created' | 'reused';

/** The host's commit port, told which food the form is putting on the line. */
export type AuthoredFoodCommitPort = (
    pick: IngredientPick,
    target: LineCommitTarget,
    outcome: AuthoredFoodOutcome,
) => Promise<LineCommitOutcome>;

/** Options for {@link useAuthoredFoodCreate}. */
export interface UseAuthoredFoodCreateOptions {
    /** The host's commit port: `useLineCommit`'s `commit`, tagged with the outcome. */
    readonly commit: AuthoredFoodCommitPort;
}

/** What a form leaf renders and wires. */
export interface AuthoredFoodCreateController {
    readonly state: AuthoredFoodCreateState;
    /** The row the open form will put the food on; `undefined` while closed. */
    readonly target: LineCommitTarget | undefined;
    /** Open the form on `name` for `target`. A no-op while it is open, so a stray second open keeps the draft. */
    readonly open: (name: string, target: LineCommitTarget) => void;
    /** Close the form and discard the draft. Ignored while a request is in flight. */
    readonly cancel: () => void;
    /** Set one field (clears that field's error). */
    readonly setField: (field: keyof AuthoredFoodDraft, value: string) => void;
    /** Validate and create; the created food then goes on the line. Ignored while a request is in flight. */
    readonly submit: () => void;
    /** From the duplicate state: put the cook's EXISTING food on the line instead. Ignored while one is in flight. */
    readonly reuseExisting: () => void;
}

/** The form's phase, with the row it is for. */
interface FormSession {
    readonly phase: AuthoredFoodCreatePhase;
    readonly target: LineCommitTarget | undefined;
}

const CLOSED: FormSession = { phase: null, target: undefined };

/** The open form, marked as having failed to submit; any other phase as it is. Pure. */
const submitFailedOf = (phase: AuthoredFoodCreatePhase): AuthoredFoodCreatePhase =>
    phase?.kind === 'open' ? { ...phase, submitFailed: true } : phase;

/** The duplicate state, marked as having failed to reuse; any other phase as it is. Pure. */
const reuseFailedOf = (phase: AuthoredFoodCreatePhase): AuthoredFoodCreatePhase =>
    phase?.kind === 'duplicate' ? { ...phase, reuseFailed: true } : phase;

/**
 * The create-my-own-food form's controller.
 *
 * @param options - The host's commit port.
 * @returns The form's state and actions.
 */
export function useAuthoredFoodCreate(options: UseAuthoredFoodCreateOptions): AuthoredFoodCreateController {
    const { commit } = options;
    const [session, setSession] = useState<FormSession>(CLOSED);
    // The commit that puts the food on the line is the port's request, not this hook's, so its in-flight fact is held
    // here: the form must read busy, and refuse a second press, until the line has the food.
    const [committing, setCommitting] = useState(false);
    const createAuthoredFood = useCreateAuthoredFood();
    const { phase, target } = session;
    const busy = createAuthoredFood.isPending || committing;

    /**
     * Put `pick` on the session's line; close on success, otherwise apply `onFailed` to the phase.
     *
     * @sideEffect Commits through the host's port.
     */
    const commitPick = (
        pick: IngredientPick,
        lineTarget: LineCommitTarget,
        outcome: AuthoredFoodOutcome,
        onFailed: (current: AuthoredFoodCreatePhase) => AuthoredFoodCreatePhase,
    ): void => {
        setCommitting(true);
        // A port that throws ends like a refusal: the form must not stay busy, unable to close.
        void commit(pick, lineTarget, outcome)
            .catch((): LineCommitOutcome => ({ kind: 'failed' }))
            .then((committed) => {
                setCommitting(false);
                setSession((current) =>
                    committed.kind === 'committed' ? CLOSED : { ...current, phase: onFailed(current.phase) },
                );
            });
    };

    return {
        state: authoredFoodCreateStateOf(phase, {
            submitting: phase?.kind === 'open' && busy,
            reusePending: phase?.kind === 'duplicate' && committing,
        }),
        target,
        open: (name, nextTarget): void => {
            if (phase !== null) {
                return;
            }

            setSession({
                phase: { kind: 'open', draft: draftFromQuery(name), fieldErrors: {}, submitFailed: false },
                target: nextTarget,
            });
        },
        cancel: (): void => {
            if (busy) {
                return;
            }

            setSession(CLOSED);
            createAuthoredFood.reset();
        },
        setField: (field, value): void => {
            setSession((current) => ({ ...current, phase: withAuthoredFoodField(current.phase, field, value) }));
        },
        submit: (): void => {
            if (phase === null || phase.kind !== 'open' || target === undefined || busy) {
                return;
            }

            const validated = validateAuthoredFoodDraft(phase.draft);

            if (!validated.ok) {
                // Inline, per field: the cook fixes the field they can see.
                setSession({ phase: { ...phase, fieldErrors: validated.fieldErrors }, target });

                return;
            }

            createAuthoredFood.mutate(validated.value, {
                onSuccess: (result) => {
                    if (result.kind === 'duplicate') {
                        // The per-author collision: a distinct state with a reuse affordance, not validation copy.
                        setSession({
                            phase: {
                                kind: 'duplicate',
                                draft: phase.draft,
                                existingFoodId: result.existingId,
                                reuseFailed: false,
                            },
                            target,
                        });

                        return;
                    }

                    // Food's name for it; a food that answers with none is named as the cook sent it.
                    const name = result.food.name ?? validated.value.name;

                    commitPick(
                        { kind: 'catalogFood', foodId: result.food.id, name },
                        target,
                        'created',
                        submitFailedOf,
                    );
                },
                onError: () => {
                    setSession((current) => ({ ...current, phase: submitFailedOf(current.phase) }));
                },
            });
        },
        reuseExisting: (): void => {
            if (phase === null || phase.kind !== 'duplicate' || target === undefined || committing) {
                return;
            }

            setSession({ phase: { ...phase, reuseFailed: false }, target });
            commitPick(
                { kind: 'catalogFood', foodId: phase.existingFoodId, name: phase.draft.name },
                target,
                'reused',
                reuseFailedOf,
            );
        },
    };
}
