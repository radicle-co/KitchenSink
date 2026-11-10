/**
 * @module @commise/features-recipes/foodPage — `useFoodEdit`: the food edit form's state and commands (private foods spec
 * section 6, states 13 and 14). It opens on the right draft (`editDraftOf`), validates with the create form's own rules
 * (`validateAuthoredFoodDraft`), sends through `useUpdateAuthoredFood`, and says the outcome politely: a private food
 * "saved", a public food's 202 "sent for review". Nothing is sent when nothing changed.
 *
 * @pattern Headless hook — the form's state for the platform sheets to render
 */
import { useMessages } from '@commise/i18n/react';
import { isConflictError } from '@kitchensink/food-service-client';
import { useUpdateAuthoredFood } from '@kitchensink/food-service-client/hooks';
import { useSnackbar } from '@commise/ui/snackbar';
import { useState } from 'react';

import {
    validateAuthoredFoodDraft,
    type AuthoredFoodDraft,
    type AuthoredFoodFieldErrors,
} from '../hooks/authoredFoodCreate.model.js';
import type { FoodPageState } from './foodPageState.js';
import {
    editDraftOf,
    editNoticeOf,
    editOutcomeOf,
    isEditUnchanged,
    isEditable,
    type EditNotice,
} from './foodEditForm.js';
import { foodPageMessages } from './messages.js';

const NO_DRAFT: AuthoredFoodDraft = { name: '', calories: '', proteinG: '', carbsG: '', fatG: '' };

/** What the edit sheets render. */
export interface FoodEditSession {
    readonly open: boolean;
    readonly name: string;
    readonly draft: AuthoredFoodDraft;
    readonly fieldErrors: AuthoredFoodFieldErrors;
    readonly notice: EditNotice;
    /** A public food's edit goes to staff, so the submit says "Send for review". */
    readonly sendsForReview: boolean;
    readonly unchanged: boolean;
    readonly submitting: boolean;
    readonly failed: boolean;
    readonly duplicate: boolean;
    readonly onOpen: () => void;
    readonly onChange: (field: keyof AuthoredFoodDraft, value: string) => void;
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
}

/**
 * The edit form of one food.
 *
 * @param state - The food page's state; the form edits from it.
 * @returns The form's session.
 * @sideEffect Sends the edit; shows a snackbar for the outcome.
 */
export function useFoodEdit(page: FoodPageState): FoodEditSession {
    // Only the author's own food has a form; any other state opens nothing (the page offers no Edit there).
    const state = isEditable(page) ? page : undefined;
    const { edit: m } = useMessages(foodPageMessages);
    const { show } = useSnackbar();
    const update = useUpdateAuthoredFood();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<AuthoredFoodDraft>(() => (state === undefined ? NO_DRAFT : editDraftOf(state)));
    const [fieldErrors, setFieldErrors] = useState<AuthoredFoodFieldErrors>({});
    const [duplicate, setDuplicate] = useState(false);
    const start = state === undefined ? NO_DRAFT : editDraftOf(state);

    const onSubmit = (): void => {
        const verdict = validateAuthoredFoodDraft(draft);

        if (!verdict.ok) {
            setFieldErrors(verdict.fieldErrors);

            return;
        }

        if (state === undefined || isEditUnchanged(draft, start) || update.isPending) {
            return;
        }

        setFieldErrors({});
        setDuplicate(false);
        update.mutate(
            { id: state.food.id, input: verdict.value },
            {
                onSuccess: (result) => {
                    setOpen(false);
                    show({ message: m[editOutcomeOf(state.kind, result)] });
                },
                onError: (error) => setDuplicate(isConflictError(error)),
            },
        );
    };

    return {
        open,
        name: start.name,
        draft,
        fieldErrors,
        notice: state === undefined ? null : editNoticeOf(state.kind),
        sendsForReview: state?.kind === 'public' || state?.kind === 'editWaiting' || state?.kind === 'editNotApproved',
        unchanged: isEditUnchanged(draft, start),
        submitting: update.isPending,
        failed: update.isError && !duplicate,
        duplicate: update.isError && duplicate,
        onOpen: () => {
            if (state === undefined) {
                return;
            }

            update.reset();
            setDuplicate(false);
            setFieldErrors({});
            setDraft(start);
            setOpen(true);
        },
        onChange: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
        onSubmit,
        onCancel: () => setOpen(false),
    };
}
