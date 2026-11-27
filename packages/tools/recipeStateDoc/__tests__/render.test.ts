/**
 * The pure renderers of the recipe state doc. The golden comparison against the committed document is the integration
 * test; here each rule is pinned on small inputs, so a broken rule fails with a small diff.
 */
import { CREATIONS, Hold, REFUSAL, TRANSITIONS, type TransitionRow } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import {
    CONFIRMATION_ROWS,
    CREATION_ROWS,
    HOLD_ROWS,
    LIFECYCLE_ROWS,
    ORIGIN_ROWS,
    REFUSAL_ROWS,
} from '../src/docProse.js';
import { adaptedTable, applyBlocks, lifecycleDiagram, markdownTable, originDiagram } from '../src/render.js';

describe('markdownTable', () => {
    it('writes a header, a rule and one line per row', () => {
        expect(markdownTable(['A', 'B'], [['1', '2']])).toBe('| A | B |\n| - | - |\n| 1 | 2 |');
    });

    it('refuses a row whose cell count is not the header’s', () => {
        expect(() => markdownTable(['A', 'B'], [['1']])).toThrow(/cells/);
    });

    it('refuses a cell holding a pipe, which would split the column', () => {
        expect(() => markdownTable(['A'], [['x | y']])).toThrow(/pipe/);
    });
});

const row = (id: string, event: string, moves: TransitionRow<'lifecycleAudience'>['moves']): TransitionRow => ({
    id,
    axis: 'lifecycleAudience',
    event,
    actors: ['cook'],
    guard: 'none',
    moves,
});

describe('lifecycleDiagram', () => {
    it('merges consecutive edges between the same two states into one labelled "A / B"', () => {
        const text = lifecycleDiagram([
            row('a', 'MAKE_PRIVATE', [{ from: 'PPu', to: 'PPr' }]),
            row('b', 'FORCE_PRIVATE', [{ from: 'PPu', to: 'PPr' }]),
            row('c', 'MAKE_PUBLIC', [{ from: 'PPr', to: 'PPu' }]),
        ]);

        expect(text).toContain('    PPu --> PPr: MAKE_PRIVATE / FORCE_PRIVATE\n');
        expect(text).toContain('    PPr --> PPu: MAKE_PUBLIC');
    });

    it('does not merge edges that are not neighbours', () => {
        const text = lifecycleDiagram([
            row('a', 'MAKE_PUBLIC', [{ from: 'PPr', to: 'PPu' }]),
            row('b', 'UNPUBLISH', [{ from: 'PPu', to: 'DPu' }]),
            row('c', 'ERASE_DONATE', [{ from: 'PPr', to: 'PPu' }]),
        ]);

        expect(text).not.toContain('MAKE_PUBLIC / ERASE_DONATE');
    });

    it('names each state by its lifecycle and audience names', () => {
        const text = lifecycleDiagram([row('a', 'DELETE', [{ from: 'DPr', to: 'Del' }])]);

        expect(text).toContain('state "LIFECYCLE_DRAFT, AUDIENCE_PRIVATE" as DPr');
        expect(text).toContain('state "LIFECYCLE_DELETED" as Del');
    });

    it('labels an edge with the document’s event name when a row has one', () => {
        const text = lifecycleDiagram([{ ...row('a', 'X_ONE', [{ from: 'DPr', to: 'DPu' }]), docEvent: 'X' }]);

        expect(text.endsWith('DPr --> DPu: X')).toBe(true);
    });
});

describe('originDiagram', () => {
    it('draws the first move of each listed row only', () => {
        const origin = (
            id: string,
            from: 'ORIGIN_UNSTATED' | 'ORIGIN_OWN',
            to: 'ORIGIN_OWN' | 'ORIGIN_BOOK',
        ): TransitionRow => ({
            id,
            axis: 'origin',
            event: id,
            actors: ['cook'],
            guard: 'none',
            moves: [
                { from, to },
                { from: 'ORIGIN_PERSON', to },
            ],
        });
        const text = originDiagram(
            [origin('ANSWER_OWN', 'ORIGIN_UNSTATED', 'ORIGIN_OWN'), origin('SKIPPED', 'ORIGIN_OWN', 'ORIGIN_BOOK')],
            ['ANSWER_OWN'],
        );

        expect(text).toContain('ORIGIN_UNSTATED --> ORIGIN_OWN: ANSWER_OWN');
        expect(text).not.toContain('ORIGIN_PERSON');
        expect(text).not.toContain('SKIPPED');
    });

    it('throws for a listed row the module does not have', () => {
        expect(() => originDiagram([], ['NOPE'])).toThrow(/NOPE/);
    });
});

describe('applyBlocks', () => {
    const doc = 'before\n<!-- recipeState:begin a -->\n\nold\n\n<!-- recipeState:end a -->\nafter\n';

    it('replaces only what lies between the markers', () => {
        expect(applyBlocks(doc, { a: 'new' })).toBe(
            'before\n<!-- recipeState:begin a -->\n\nnew\n\n<!-- recipeState:end a -->\nafter\n',
        );
    });

    it('is idempotent', () => {
        const once = applyBlocks(doc, { a: 'new' });

        expect(applyBlocks(once, { a: 'new' })).toBe(once);
    });

    it('throws for a block with no markers, and for markers with no block', () => {
        expect(() => applyBlocks(doc, { a: 'x', b: 'y' })).toThrow(/b/);
        expect(() => applyBlocks(doc, {})).toThrow(/a/);
    });
});

describe('the prose is keyed by the module', () => {
    const groups = (axis: string): string[] =>
        [...new Set(TRANSITIONS.filter((candidate) => candidate.axis === axis).map((r) => r.group ?? r.id))].sort();

    it('has a refusal row for every refusal name that has one, and no other', () => {
        const names = REFUSAL_ROWS.map((entry) => entry.name);

        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort()).toEqual(Object.keys(REFUSAL).sort());
    });

    it('has a hold row for every hold, and a creation row for every creation', () => {
        expect(HOLD_ROWS.map((entry) => entry.name).sort()).toEqual(Object.keys(Hold).sort());
        expect(CREATION_ROWS.map((entry) => entry.id)).toEqual(CREATIONS.map((entry) => entry.id));
    });

    it('has a table row for every group of the lifecycle, origin and confirmation edges, and no other', () => {
        expect(LIFECYCLE_ROWS.map((entry) => entry.group).sort()).toEqual(groups('lifecycleAudience'));
        expect(ORIGIN_ROWS.map((entry) => entry.group).sort()).toEqual(groups('origin'));
        expect(CONFIRMATION_ROWS.map((entry) => entry.group).sort()).toEqual(groups('sourceConfirmation'));
    });
});

describe('adaptedTable (4.8)', () => {
    const labels = {
        'VIEW_ADAPTED_BY_COOK.heading.owner': 'Adapted by you from',
        'VIEW_ADAPTED_BY_COOK.heading.reader': 'Adapted by {cook} from',
        'VIEW_ADAPTED_BY_COOK.headingNoCitation.book.owner': 'Adapted by you from a book',
        'VIEW_ADAPTED_BY_COOK.headingNoCitation.book.reader': 'Adapted by {cook} from a book',
        'VIEW_ADAPTED_BY_COOK.earnedSentence': 'This recipe is now marked Adapted by you.',
    } as const;

    it('writes a row per heading shape, from the registry’s shapes and the messages', () => {
        const text = adaptedTable(
            [
                '.heading.owner',
                '.heading.reader',
                '.headingNoCitation.book.owner',
                '.headingNoCitation.book.reader',
                '.earnedSentence',
            ],
            (shape) => labels[`VIEW_ADAPTED_BY_COOK${shape}` as keyof typeof labels] ?? '',
        );

        expect(text).toContain(
            '| `.heading` (over the citation and link) | Adapted by you from | Adapted by {cook} from |',
        );
        expect(text).toContain(
            '| `.headingNoCitation.book` | Adapted by you from a book | Adapted by {cook} from a book |',
        );
    });

    it('writes the earned sentence as an owner-only row, and never as a toast', () => {
        const text = adaptedTable(['.earnedSentence'], () => 'This recipe is now marked Adapted by you.');

        expect(text).toContain('| `.earnedSentence` | This recipe is now marked Adapted by you. | none (owner only) |');
        expect(text).not.toMatch(/toast/i);
    });

    it('throws for a shape that is neither a heading with owner and reader forms nor the earned sentence', () => {
        expect(() => adaptedTable(['.owner'], () => 'x')).toThrow(/\.owner/);
    });
});
