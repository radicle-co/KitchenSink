/**
 * @module @commise/features-recipes/foodPage — the food edit form's pure half (private foods spec section 6, states 13 and
 * 14): what it starts from, which notice it carries, whether anything changed, and what is said after the answer.
 *
 * A private food saves at once; a public food's edit goes to staff and readers keep the approved version (ADR-0029
 * section 7). Pure.
 */
import type { UpdateAuthoredFoodResult } from '@kitchensink/food-service-client';
import type { PublicationStateValue } from '@kitchensink/schema-food';

import type { AuthoredFoodDraft } from '../hooks/authoredFoodCreate.model.js';
import { figureText, macrosOfFood } from './foodEditComparison.js';
import type { FoodPageState } from './foodPageState.js';

/** A page state the cook can edit from. */
export type EditableState = Extract<FoodPageState, { readonly food: unknown; readonly request: unknown }>;

/** Whether a page state is one the cook can edit from: the author's own food, and not a withdrawn one. Pure. */
export function isEditable(state: FoodPageState): state is EditableState {
    return 'request' in state && state.kind !== 'withdrawn';
}

/** The states whose newest request holds the version the cook should edit from. */
const EDIT_FROM_REQUEST: ReadonlySet<PublicationStateValue> = new Set([
    'editWaiting',
    'notApproved',
    'editNotApproved',
]);

/**
 * The draft the form opens on. A waiting edit is edited from the WAITING version, never the public one under it (or the cook
 * loses it); a declined version is edited from itself, so the cook fixes the one thing staff named. Pure.
 */
export function editDraftOf(state: EditableState): AuthoredFoodDraft {
    const snapshot = EDIT_FROM_REQUEST.has(state.kind) ? state.request?.snapshot : undefined;

    if (snapshot !== undefined) {
        const { calories, proteinG, carbsG, fatG } = snapshot.macros;

        return {
            name: snapshot.name,
            calories: figureText(calories),
            proteinG: figureText(proteinG),
            carbsG: figureText(carbsG),
            fatG: figureText(fatG),
        };
    }

    const macros = macrosOfFood(state.food);
    const text = (value: number | undefined): string => (value === undefined ? '' : figureText(value));

    return {
        name: state.food.name ?? '',
        calories: text(macros.calories),
        proteinG: text(macros.proteinG),
        carbsG: text(macros.carbsG),
        fatG: text(macros.fatG),
    };
}

/** The notice above the form, by state. */
export type EditNotice = 'review' | 'replacesWaiting' | 'askReplaced' | null;

/**
 * Which notice the form carries (section 6.2, 6.3): a public food says staff review every change; a waiting edit adds that
 * this replaces it; a private food with an open ask says saving sends this version instead. Pure.
 */
export function editNoticeOf(kind: PublicationStateValue): EditNotice {
    switch (kind) {
        case 'public':
        case 'editNotApproved':
            return 'review';
        case 'editWaiting':
            return 'replacesWaiting';
        case 'asked':
            return 'askReplaced';
        case 'private':
        case 'notApproved':
        case 'withdrawn':
            return null;
    }
}

/** Whether the draft is what the form opened on, so there is nothing to send. Pure. */
export function isEditUnchanged(draft: AuthoredFoodDraft, start: AuthoredFoodDraft): boolean {
    return (
        draft.name.trim() === start.name.trim() &&
        draft.calories === start.calories &&
        draft.proteinG === start.proteinG &&
        draft.carbsG === start.carbsG &&
        draft.fatG === start.fatG
    );
}

/** What is said after the answer. */
export type EditOutcome = 'saved' | 'askResent' | 'sent';

/** The words after an edit: a 202 is "sent for review", never "saved". Pure. */
export function editOutcomeOf(kind: PublicationStateValue, result: UpdateAuthoredFoodResult): EditOutcome {
    if (result.kind === 'editPending') {
        return 'sent';
    }

    return kind === 'asked' ? 'askResent' : 'saved';
}
