/**
 * The details dialog statechart (curated plan U14, "Details dialog statechart"): one case per transition.
 *
 * The read-driven states are derived from the food read and the search text, so each edge is a change of input. The
 * terminal edges (picked, removed, dismissed) are outcomes the dialog hands its host's commit port.
 */
import type { IngredientVariant } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { BEEF_BRISKET, BONELESS_SKINLESS_CHICKEN_THIGHS } from '../__fixtures__/seedVariants.js';
import {
    type DetailsDialogEntry,
    type DetailsDialogState,
    type DetailsRead,
    closeOutcome,
    deriveDetailsDialogState,
    pickOutcome,
    removeOutcome,
    settledSearchOf,
} from '../detailsDialogMachine.js';
import { planVariantList, rowsOfPlan } from '../groupVariants.js';

const LOCALE = 'en';
const ADD: DetailsDialogEntry = { mode: 'add' };

/** A loaded read of `variants`. */
function loaded(variants: Parameters<typeof planVariantList>[0]): DetailsRead {
    return { kind: 'loaded', plan: planVariantList(variants, LOCALE) };
}

/** The line's own binding, for `edit` mode. */
function bound(variant: { readonly id: string; readonly parts: IngredientVariant['parts'] }): DetailsDialogEntry {
    return { mode: 'edit', current: { id: variant.id, parts: variant.parts } };
}

const THIGHS = loaded(BONELESS_SKINLESS_CHICKEN_THIGHS);
const BRISKET = loaded(BEEF_BRISKET);
const THIGH = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
const RETIRED: IngredientVariant = { id: 'V-retired', parts: [{ attribute: 'cut', text: 'gone' }] };

/** Derive with an empty query unless one is given. */
function derive(read: DetailsRead, entry: DetailsDialogEntry, query = ''): DetailsDialogState {
    return deriveDetailsDialogState({ read, entry, query, locale: LOCALE });
}

describe('read-driven edges', () => {
    it('[*] → loading', () => {
        expect(derive({ kind: 'loading' }, ADD).name).toBe('loading');
    });

    it('loading → error: fetch failed', () => {
        expect(derive({ kind: 'failed' }, ADD).name).toBe('error');
    });

    it('error → loading: retry (the read is loading again)', () => {
        expect(derive({ kind: 'loading' }, ADD).name).toBe('loading');
    });

    it('a parked read is the offline slot, not a list state', () => {
        expect(derive({ kind: 'parked' }, ADD).name).toBe('offline');
    });

    it('loading → noVariants: no live variants, opened to add', () => {
        expect(derive(loaded([]), ADD).name).toBe('noVariants');
    });

    it('loading → detailsNoneLeft: current variant retired, no live sibling', () => {
        expect(derive(loaded([]), bound(RETIRED))).toEqual({ name: 'detailsNoneLeft', current: RETIRED });
    });

    it('loading → combined: fewer than 8 live variants', () => {
        const state = derive(THIGHS, ADD);

        expect(state.name).toBe('combined');
        expect(state.name === 'combined' && state.rows).toHaveLength(7);
    });

    it('loading → longList: 8 or more live variants', () => {
        const state = derive(BRISKET, ADD);

        expect(state.name).toBe('longList');
        expect(state.name === 'longList' && state.total).toBe(40);
    });
});

describe('search edges (long list)', () => {
    it('longList → searching: query typed', () => {
        const state = derive(BRISKET, ADD, 'navel');

        expect(state.name).toBe('searching');
        expect(state.name === 'searching' && [state.shown, state.total]).toEqual([4, 40]);
    });

    it('searching → noMatches: zero results', () => {
        expect(derive(BRISKET, ADD, 'zzz')).toMatchObject({ name: 'noMatches', total: 40, query: 'zzz' });
    });

    it('longList → noMatches: the first characters typed match nothing', () => {
        expect(derive(BRISKET, ADD).name).toBe('longList');
        expect(derive(BRISKET, ADD, 'q').name).toBe('noMatches');
    });

    it('noMatches → searching: query changed', () => {
        expect(derive(BRISKET, ADD, 'zzz').name).toBe('noMatches');
        expect(derive(BRISKET, ADD, 'whole').name).toBe('searching');
    });

    it('searching → longList: query cleared', () => {
        expect(derive(BRISKET, ADD, '').name).toBe('longList');
    });

    it('noMatches → longList: query cleared (§S8.5, Clear is the way out)', () => {
        expect(derive(BRISKET, ADD, 'zzz').name).toBe('noMatches');
        expect(derive(BRISKET, ADD, '   ').name).toBe('longList');
    });

    it('a short list ignores a query, because it has no search', () => {
        expect(derive(THIGHS, ADD, 'zzz').name).toBe('combined');
    });
});

describe('settledSearchOf — what a settled search announces (§S8.5)', () => {
    it('a search that leaves rows: their count, out of the whole list', () => {
        expect(settledSearchOf(derive(BRISKET, ADD, 'navel'))).toEqual({ kind: 'matches', shown: 4, total: 40 });
    });

    it('a search that leaves none: "no matches", with the trimmed text it was asked', () => {
        expect(settledSearchOf(derive(BRISKET, ADD, ' zzz '))).toEqual({ kind: 'noMatches', query: 'zzz', total: 40 });
    });

    it('a state with no search: nothing', () => {
        expect(settledSearchOf(derive(BRISKET, ADD))).toBeUndefined();
        expect(settledSearchOf(derive(THIGHS, ADD, 'zzz'))).toBeUndefined();
        expect(settledSearchOf({ name: 'loading' })).toBeUndefined();
    });
});

describe('the current variant (edit mode)', () => {
    it('marks a listed current variant', () => {
        const state = derive(THIGHS, bound(THIGH));

        expect(state.name === 'combined' && state.current).toEqual({
            variant: { id: THIGH.id, parts: THIGH.parts },
            listed: true,
        });
    });

    it('keeps a retired current variant, unlisted, while live siblings remain (§S8.7)', () => {
        const state = derive(BRISKET, bound(RETIRED));

        expect(state.name === 'longList' && state.current).toEqual({ variant: RETIRED, listed: false });
    });

    it('has no current mark when opened to add', () => {
        const state = derive(THIGHS, ADD);

        expect(state.name === 'combined' && state.current).toBeUndefined();
    });
});

describe('terminal edges: picked, removed, dismissed', () => {
    const rows = rowsOfPlan(planVariantList(BONELESS_SKINLESS_CHICKEN_THIGHS, LOCALE));
    const other = rows.find((row) => row.variant.id !== THIGH.id)!;
    const same = rows.find((row) => row.variant.id === THIGH.id)!;

    it('combined → picked → committed: another row chosen, carrying the id and every part', () => {
        expect(pickOutcome(ADD, other)).toEqual({
            kind: 'committed',
            mode: 'add',
            variant: { id: other.variant.id, parts: other.variant.parts },
        });
    });

    it('picked → dismissed: the current row chosen writes nothing', () => {
        expect(pickOutcome(bound(THIGH), same)).toEqual({ kind: 'dismissed' });
    });

    it('picked → committed in edit mode reports the change as an edit', () => {
        expect(pickOutcome(bound(THIGH), other)).toMatchObject({ kind: 'committed', mode: 'edit' });
    });

    it.each(['combined', 'longList', 'searching', 'noMatches', 'detailsNoneLeft'] as const)(
        '%s → removed: remove details, opened to edit',
        (name) => {
            const read = name === 'combined' ? THIGHS : name === 'detailsNoneLeft' ? loaded([]) : BRISKET;
            const query = name === 'searching' ? 'navel' : name === 'noMatches' ? 'zzz' : '';
            const state = derive(read, bound(name === 'combined' ? THIGH : RETIRED), query);

            expect(state.name).toBe(name);
            expect(removeOutcome(bound(THIGH), state)).toEqual({ kind: 'removed' });
        },
    );

    it('has no removal when opened to add', () => {
        expect(removeOutcome(ADD, derive(THIGHS, ADD))).toBeUndefined();
        expect(removeOutcome(ADD, derive(BRISKET, ADD))).toBeUndefined();
    });

    it.each(['loading', 'error', 'offline', 'noVariants'] as const)('has no removal in %s', (name) => {
        const read: DetailsRead =
            name === 'loading'
                ? { kind: 'loading' }
                : name === 'error'
                  ? { kind: 'failed' }
                  : name === 'offline'
                    ? { kind: 'parked' }
                    : loaded([]);
        const entry = name === 'noVariants' ? ADD : bound(THIGH);
        const state = derive(read, entry);

        expect(state.name).toBe(name);
        expect(removeOutcome(entry, state)).toBeUndefined();
    });

    it('every state → dismissed: close, Escape, overlay, swipe or back write nothing', () => {
        expect(closeOutcome()).toEqual({ kind: 'dismissed' });
    });
});
