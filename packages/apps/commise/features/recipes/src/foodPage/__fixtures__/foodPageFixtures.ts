import type { FoodResponse, PublicationRequestDetail, PublicationStateValue } from '@kitchensink/schema-food';

import type { EditableState } from '../foodEditForm.js';
import type { FoodPageState } from '../foodPageState.js';
import type { FoodPageViewProps } from '../foodPageViewProps.js';

/**
 * An authored food with the four figures and one portion. Its nutrient rows disagree with its `authoredMacros` on
 * purpose: the page reads the authored figures, so a page that read the rows by name would show 999 and fail.
 */
export function makeFood(overrides: Partial<FoodResponse> = {}): FoodResponse {
    return {
        id: 'food_1',
        name: 'Oat milk',
        description: null,
        kind: 'generic',
        status: 'RESOLVED',
        nutrients: [
            { nutrient: 'Energy', amount: 999, unit: 'kcal', basis: 'per_100g', source: 'author' },
            { nutrient: 'Protein', amount: 99, unit: 'g', basis: 'per_100g', source: 'author' },
            { nutrient: 'Carbohydrate, by difference', amount: 99, unit: 'g', basis: 'per_100g', source: 'author' },
            { nutrient: 'Total lipid (fat)', amount: 99, unit: 'g', basis: 'per_100g', source: 'author' },
        ],
        portions: [{ label: '1 cup', gramWeight: 240, source: 'author' }],
        provenance: {},
        authoredMacros: { calories: 120, proteinG: 3, carbsG: 16, fatG: 5 },
        variants: [],
        ...overrides,
    };
}

/** The newest request, declined by default. */
export function makeRequest(overrides: Partial<PublicationRequestDetail['request']> = {}): PublicationRequestDetail {
    return {
        request: {
            id: 'req_1',
            foodId: 'food_1',
            versionNumber: 2,
            status: 'declined',
            declineReason: 'The calories look too low.',
            createdAt: '2026-11-09T10:00:00.000Z',
            decidedAt: '2026-11-09T11:00:00.000Z',
            ...overrides,
        },
        snapshot: {
            name: 'Oat milk',
            description: null,
            macros: { calories: 135, proteinG: 3, carbsG: 16, fatG: 5 },
            portions: [],
        },
    };
}

/** An author state of the page. */
export function makeOwnState(
    kind: PublicationStateValue,
    overrides: { readonly request?: PublicationRequestDetail | undefined; readonly actionsDisabled?: boolean } = {},
): EditableState {
    return {
        kind,
        food: makeFood({ publicationState: kind }),
        request: 'request' in overrides ? overrides.request : makeRequest(),
        actionsDisabled: overrides.actionsDisabled ?? false,
    } as EditableState;
}

/** The view’s props with every handler a spy-able no-op. */
export function makeViewProps(state: FoodPageState, handlers: Partial<FoodPageViewProps> = {}): FoodPageViewProps {
    const none = (): void => undefined;

    return {
        state,
        ask: 'idle',
        withdraw: { open: false, busy: false, failed: false },
        onEdit: none,
        onAsk: none,
        onWithdraw: none,
        onWithdrawConfirm: none,
        onWithdrawKeep: none,
        onRetry: none,
        onLeave: none,
        ...handlers,
    };
}
