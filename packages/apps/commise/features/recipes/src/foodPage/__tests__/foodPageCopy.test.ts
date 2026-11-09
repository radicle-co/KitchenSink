/**
 * `foodPageCopyOf`: the words, badges and actions of each author state (private foods spec section 5.8 to 5.16). The
 * leaves only draw this, so the twelve states are pinned here once, for both platforms. Mutation lens: swapping two
 * states’ statements, showing Ask in state 7, or offering Withdraw on a withdrawn food each fail a case below.
 */
import type { FoodResponse, PublicationRequestDetail } from '@kitchensink/schema-food';
import { describe, expect, it } from 'vitest';

import { foodPageCopyOf } from '../foodPageCopy.js';
import type { FoodPageState } from '../foodPageState.js';
import { foodPageMessages } from '../messages.js';

const m = foodPageMessages.en;
const FOOD: FoodResponse = {
    id: 'f1',
    name: 'Oat milk',
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [
        { nutrient: 'Energy', amount: 120, unit: 'kcal', basis: 'per_100g', source: 'authored' },
        { nutrient: 'Protein', amount: 0, unit: 'g', basis: 'per_100g', source: 'authored' },
        { nutrient: 'Carbohydrate, by difference', amount: 0, unit: 'g', basis: 'per_100g', source: 'authored' },
        { nutrient: 'Total lipid (fat)', amount: 0, unit: 'g', basis: 'per_100g', source: 'authored' },
    ],
    portions: [],
    provenance: {},
    variants: [],
};
const REQUEST: PublicationRequestDetail = {
    request: {
        id: 'r1',
        foodId: 'f1',
        versionNumber: 2,
        status: 'declined',
        declineReason: 'The calories look too low.',
        createdAt: '2026-11-09T10:00:00.000Z',
        decidedAt: '2026-11-09T11:00:00.000Z',
    },
    snapshot: {
        name: 'Oat milk',
        description: null,
        macros: { calories: 135, proteinG: 0, carbsG: 0, fatG: 0 },
        portions: [],
    },
};

function copy(kind: Exclude<FoodPageState['kind'], 'loading' | 'notFound' | 'error' | 'offline' | 'othersPublic'>) {
    return foodPageCopyOf({ kind, food: FOOD, request: REQUEST, actionsDisabled: false }, m, 'en-US');
}

describe('foodPageCopyOf', () => {
    it('5 private: one badge, the statement, the one-way note, and Edit then Ask (Ask is the primary)', () => {
        const c = copy('private');

        expect(c.badges).toEqual([{ status: 'private', text: 'Private' }]);
        expect(c.statement).toBe(m.private.statement);
        expect(c.details).toEqual([m.private.askNote]);
        expect(c.actions).toEqual([
            { key: 'edit', variant: 'secondary' },
            { key: 'ask', variant: 'primary' },
        ]);
        expect(c.withdraw).toEqual({ offered: true, body: m.withdraw.bodyPrivate });
    });

    it('6 asked: Private and Waiting for review, the ask’s date, Edit only, and the ask-cancelling withdraw body', () => {
        const c = copy('asked');

        expect(c.badges.map((b) => b.text)).toEqual(['Private', 'Waiting for review']);
        expect(c.badges[1]?.status).toBe('note');
        expect(c.statement).toBe('You asked to make this food public on Nov 9, 2026.');
        expect(c.actions.map((a) => a.key)).toEqual(['edit']);
        expect(c.withdraw.body).toBe(m.withdraw.bodyAsked);
    });

    it('7 not approved: the staff reason as written, Edit is the primary, and there is no Ask', () => {
        const c = copy('notApproved');

        expect(c.badges[1]).toEqual({ status: 'attention', text: 'Not approved' });
        expect(c.details).toEqual(['Their reason: The calories look too low.', m.declined.next]);
        expect(c.actions).toEqual([{ key: 'edit', variant: 'primary' }]);
        expect(c.withdraw.body).toBe(m.withdraw.bodyPrivate);
    });

    it('8 public: Public, the statement, Edit, and the public withdraw body', () => {
        const c = copy('public');

        expect(c.badges).toEqual([{ status: 'public', text: 'Public' }]);
        expect(c.details).toEqual([m.public.detail]);
        expect(c.actions.map((a) => a.key)).toEqual(['edit']);
        expect(c.withdraw.body).toBe(m.withdraw.bodyPublic);
    });

    it('9 edit waiting: Public and Edit waiting for review, and the comparison of only what changed', () => {
        const c = copy('editWaiting');

        expect(c.badges.map((b) => b.text)).toEqual(['Public', 'Edit waiting for review']);
        expect(c.statement).toBe('You sent an edit for review on Nov 9, 2026.');
        expect(c.comparison?.heading).toBe('Your edit');
        expect(c.comparison?.rows).toEqual([
            { text: '120 kcal → 135 kcal', spoken: 'Calories: public 120 kcal, your edit 135 kcal', label: 'Calories' },
        ]);
        expect(c.comparison?.rest).toBe('Nothing else changes.');
    });

    it('10 edit not approved: Public and Edit not approved, the reason, the public version unchanged', () => {
        const c = copy('editNotApproved');

        expect(c.badges[1]).toEqual({ status: 'attention', text: 'Edit not approved' });
        expect(c.details[0]).toBe('Their reason: The calories look too low.');
        expect(c.details[1]).toBe(m.editDeclined.next);
        expect(c.actions.map((a) => a.key)).toEqual(['edit']);
    });

    it('11 withdrawn: a quiet Withdrawn badge, no actions, no Withdraw', () => {
        const c = copy('withdrawn');

        expect(c.badges).toEqual([{ status: 'note', text: 'Withdrawn' }]);
        expect(c.actions).toEqual([]);
        expect(c.withdraw.offered).toBe(false);
    });

    it('never claims a date or a reason it was not given: no request yet reads without them', () => {
        const c = foodPageCopyOf(
            { kind: 'notApproved', food: FOOD, request: undefined, actionsDisabled: false },
            m,
            'en-US',
        );

        expect(c.details).toEqual([m.declined.next]);
        expect(c.comparison).toBeUndefined();
    });

    it('a cached copy with no connection keeps the actions, disables them, and says why', () => {
        const c = foodPageCopyOf(
            { kind: 'private', food: FOOD, request: undefined, actionsDisabled: true },
            m,
            'en-US',
        );

        expect(c.actionsDisabled).toBe(true);
        expect(c.actionsNote).toBe(m.offlineActions);
    });

    it('12 another cook’s public food: Public and the facts, with no panel, no actions, no Withdraw', () => {
        const c = foodPageCopyOf({ kind: 'othersPublic', food: FOOD }, m, 'en-US');

        expect(c.badges).toEqual([{ status: 'public', text: 'Public' }]);
        expect(c.statement).toBeUndefined();
        expect(c.actions).toEqual([]);
        expect(c.withdraw.offered).toBe(false);
    });
});
