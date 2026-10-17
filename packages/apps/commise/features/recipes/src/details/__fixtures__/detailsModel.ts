/**
 * A details dialog model for the leaf tests (curated U14): a real derived state, with spy handlers.
 */
import type { IngredientVariant } from '@kitchensink/recipe-core';
import type { VariantView } from '@kitchensink/food-service-client';
import { vi } from 'vitest';

import {
    type DetailsDialogEntry,
    type DetailsRead,
    deriveDetailsDialogState,
    removeOutcome,
} from '../detailsDialogMachine.js';
import { planVariantList } from '../groupVariants.js';
import type { VariantDetailsDialogModel } from '../useVariantDetailsDialog.js';

/** A loaded read of `variants`. */
export function loadedRead(variants: readonly VariantView[]): DetailsRead {
    return { kind: 'loaded', plan: planVariantList(variants, 'en') };
}

/** The `edit` entry for a line bound to `variant`. */
export function editEntry(variant: {
    readonly id: string;
    readonly parts: IngredientVariant['parts'];
}): DetailsDialogEntry {
    return { mode: 'edit', current: { id: variant.id, parts: variant.parts } };
}

/**
 * A model for `read`, `entry` and `query`, with every handler a spy.
 *
 * @param input - The read, the entry and the search text.
 * @param overrides - Fields to replace.
 * @returns The model.
 */
export function makeDetailsModel(
    input: { readonly read: DetailsRead; readonly entry: DetailsDialogEntry; readonly query?: string },
    overrides: Partial<VariantDetailsDialogModel> = {},
): VariantDetailsDialogModel {
    const query = input.query ?? '';
    const state = deriveDetailsDialogState({ read: input.read, entry: input.entry, query, locale: 'en' });
    const removal = removeOutcome(input.entry, state);

    return {
        mode: input.entry.mode,
        state,
        query,
        onQueryChange: vi.fn(),
        onClearQuery: vi.fn(),
        onRetry: vi.fn(),
        onPick: vi.fn(),
        onRemove: removal === undefined ? undefined : vi.fn(),
        onClose: vi.fn(),
        announcedCount: undefined,
        ...overrides,
    };
}
