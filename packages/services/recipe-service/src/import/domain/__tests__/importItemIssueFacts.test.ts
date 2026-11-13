/**
 * `itemIssueFactsOf`, the ONE place the facts an item's issue is derived from are built (review L2 on #220). The save and the
 * item list each built them by hand, and their guards had already drifted apart: the list judged no refusal for a saved item
 * and no save gap for an unmatched one, the save did neither. Each case pins one guard, so a copy that drops it fails here.
 */
import { describe, expect, it } from 'vitest';

import { makeItem } from '../../__fixtures__/importFixtures.js';
import { itemIssueFactsOf, type ItemIssueInput } from '../importItemIssueFacts.js';

const FREE_COOK = { principalKind: 'real', containment: 'enforce', isPremium: false } as const;
const FILE = {
    file: { cuisine: 'Italian', servings: 4, prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
    ingredientLineCount: 2,
    stepCount: 1,
};

const input = (patch: Partial<ItemIssueInput> = {}): ItemIssueInput => ({
    item: makeItem({ stage: 'matched', allowanceSpentAt: new Date('2026-11-13T00:00:00.000Z') }),
    statement: { kind: 'authored' },
    requested: 'private',
    cook: FREE_COOK,
    saveFacts: FILE,
    outOfSlots: false,
    allowanceSpent: false,
    ...patch,
});

describe('itemIssueFactsOf: the facts one item’s issue is derived from', () => {
    it('reads a matched, stated, complete item as saveable, with the facts the create sends', () => {
        const { facts, reading } = itemIssueFactsOf(input());

        expect(facts).toMatchObject({ stage: 'matched', refusal: null, hasStatement: true, saveGap: null, paid: true });
        expect(reading).toStrictEqual({
            saveable: {
                cuisine: 'Italian',
                servings: 4,
                prepTimeMinutes: 10,
                cookTimeMinutes: 20,
                totalTimeMinutes: 30,
            },
        });
    });

    it('takes the cook’s choices over the file’s, through the one resolution', () => {
        const { reading } = itemIssueFactsOf(input({ item: makeItem({ stage: 'matched', servings: 2 }) }));

        expect(reading).toMatchObject({ saveable: { servings: 2 } });
    });

    it('names the save gap for a matched item the save cannot send', () => {
        const { facts, reading } = itemIssueFactsOf(
            input({ saveFacts: { ...FILE, file: { ...FILE.file, servings: null } } }),
        );

        expect(facts.saveGap).toBe('servings');
        expect(reading).toStrictEqual({ gap: 'servings' });
    });

    it('derives a refusal from the counts when none is stored, and judges no save gap for it', () => {
        const { facts, reading } = itemIssueFactsOf(input({ saveFacts: { ...FILE, stepCount: 0 } }));

        expect(facts.refusal).toBe('noSteps');
        expect(facts.saveGap).toBeNull();
        expect(reading).toBeUndefined();
    });

    it('keeps a stored refusal over the counts', () => {
        const { facts } = itemIssueFactsOf(input({ item: makeItem({ stage: 'received', refusal: 'noIngredients' }) }));

        expect(facts.refusal).toBe('noIngredients');
    });

    it('⛔ judges no refusal for a SAVED item, whose payload is gone (the list’s guard)', () => {
        const { facts } = itemIssueFactsOf(
            input({ item: makeItem({ stage: 'saved' }), saveFacts: { ...FILE, ingredientLineCount: 0, stepCount: 0 } }),
        );

        expect(facts.refusal).toBeNull();
    });

    it('⛔ judges no save gap for an item that is not matched yet (the list’s guard)', () => {
        const { facts, reading } = itemIssueFactsOf(
            input({
                item: makeItem({ stage: 'parsing' }),
                saveFacts: { ...FILE, file: { ...FILE.file, servings: null } },
            }),
        );

        expect(facts.saveGap).toBeNull();
        expect(reading).toBeUndefined();
    });

    it('judges no save gap and no visibility without a statement', () => {
        const { facts, reading } = itemIssueFactsOf(input({ statement: undefined, requested: 'public' }));

        expect(facts).toMatchObject({ hasStatement: false, visibilityRefused: false, saveGap: null });
        expect(reading).toBeUndefined();
    });

    it('refuses a public book recipe on its label, and allows it private', () => {
        const book = { kind: 'book', citation: 'A Book, p. 4' } as const;

        expect(itemIssueFactsOf(input({ statement: book, requested: 'public' })).facts.visibilityRefused).toBe(true);
        expect(itemIssueFactsOf(input({ statement: book, requested: 'private' })).facts.visibilityRefused).toBe(false);
    });

    it('reads paid from the item, and passes the slot and allowance facts through', () => {
        const { facts } = itemIssueFactsOf(
            input({ item: makeItem({ stage: 'received' }), outOfSlots: true, allowanceSpent: true }),
        );

        expect(facts).toMatchObject({ paid: false, outOfSlots: true, allowanceSpent: true, private: true });
    });

    it('reads the hold at the current revision from the item', () => {
        expect(
            itemIssueFactsOf(input({ item: makeItem({ stage: 'matched', heldAtRev: 3, decisionRev: 3 }) })).facts
                .heldAtCurrentRevision,
        ).toBe(true);
        expect(
            itemIssueFactsOf(input({ item: makeItem({ stage: 'matched', heldAtRev: 2, decisionRev: 3 }) })).facts
                .heldAtCurrentRevision,
        ).toBe(false);
    });
});
