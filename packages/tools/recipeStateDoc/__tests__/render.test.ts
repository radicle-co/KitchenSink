/**
 * The pure renderers of the recipe state doc. The golden comparison against the committed document is the integration
 * test; here each rule is pinned on small inputs, so a broken rule fails with a small diff.
 */
import { readFileSync } from 'node:fs';

import { recipeStateMessages } from '@commise/features-recipes/recipe-state-messages';
import { CREATIONS, Hold, REFUSAL, TRANSITIONS, type TransitionRow } from '@kitchensink/recipe-core/recipe-state';
import { describe, expect, it } from 'vitest';

import {
    CONFIRMATION_ROWS,
    CREATION_ROWS,
    HOLD_ROWS,
    LIFECYCLE_ROWS,
    ORIGIN_ROWS,
    REFUSAL_ROWS,
} from '../src/docProse.js';
import {
    adaptedTable,
    applyBlocks,
    enCellOf,
    labelsIn,
    lifecycleDiagram,
    markdownTable,
    originDiagram,
} from '../src/render.js';

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
            row('b', 'MOVE_AWAY', [{ from: 'PPu', to: 'PPr' }]),
            row('c', 'MAKE_PUBLIC', [{ from: 'PPr', to: 'PPu' }]),
        ]);

        expect(text).toContain('    PPu --> PPr: MAKE_PRIVATE / MOVE_AWAY\n');
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

    it('copes with 10,000 repeated begin markers: the first opens the block and the rest are swallowed', () => {
        const hostile = `${'<!-- recipeState:begin ! -->\n'.repeat(10_000)}<!-- recipeState:end ! -->\n`;

        expect(applyBlocks(hostile, { '!': 'new' })).toBe(
            '<!-- recipeState:begin ! -->\n\nnew\n\n<!-- recipeState:end ! -->\n',
        );
        expect(() => applyBlocks('<!-- recipeState:begin ! -->\n'.repeat(10_000), { '!': 'new' })).toThrow(
            /end marker/,
        );
    });

    it('throws for a begin marker that has no end marker, rather than leaving the stale block in place', () => {
        expect(() => applyBlocks('<!-- recipeState:begin a -->\n\nold\n', { a: 'new' })).toThrow(/end marker/);
    });
});

const byText = (a: string, b: string): number => a.localeCompare(b);

describe('the prose is keyed by the module', () => {
    const groups = (axis: string): string[] =>
        [...new Set(TRANSITIONS.filter((candidate) => candidate.axis === axis).map((r) => r.group ?? r.id))].sort(
            byText,
        );

    it('has a refusal row for every refusal name that has one, and no other', () => {
        const names = REFUSAL_ROWS.map((entry) => entry.name);

        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort(byText)).toEqual(Object.keys(REFUSAL).sort(byText));
    });

    it('has a hold row for every hold, and a creation row for every creation', () => {
        expect(HOLD_ROWS.map((entry) => entry.name).sort(byText)).toEqual(Object.keys(Hold).sort(byText));
        expect(CREATION_ROWS.map((entry) => entry.id)).toEqual(CREATIONS.map((entry) => entry.id));
    });

    it('has a table row for every group of the lifecycle, origin and confirmation edges, and no other', () => {
        expect(LIFECYCLE_ROWS.map((entry) => entry.group).sort(byText)).toEqual(groups('lifecycleAudience'));
        expect(ORIGIN_ROWS.map((entry) => entry.group).sort(byText)).toEqual(groups('origin'));
        expect(CONFIRMATION_ROWS.map((entry) => entry.group).sort(byText)).toEqual(groups('sourceConfirmation'));
    });
});

describe('adaptedTable (4.8)', () => {
    const labels: Readonly<Record<string, string>> = {
        'VIEW_ADAPTED_BY_COOK.heading.owner': 'Adapted by you from',
        'VIEW_ADAPTED_BY_COOK.heading.reader': 'Adapted by {cook} from',
        'VIEW_ADAPTED_BY_COOK.headingNoCitation.book.owner': 'Adapted by you from a book',
        'VIEW_ADAPTED_BY_COOK.headingNoCitation.book.reader': 'Adapted by {cook} from a book',
        'VIEW_ADAPTED_BY_COOK.earnedSentence': 'This recipe is now marked Adapted by you.',
    };
    const labelOf = new Map(Object.entries(labels));

    it('writes a row per heading shape, from the registry’s shapes and the messages', () => {
        const text = adaptedTable(
            [
                '.heading.owner',
                '.heading.reader',
                '.headingNoCitation.book.owner',
                '.headingNoCitation.book.reader',
                '.earnedSentence',
            ],
            (shape) => labelOf.get(`VIEW_ADAPTED_BY_COOK${shape}`) ?? '',
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

describe('enCellOf', () => {
    it('leaves a cell that quotes nothing as it is', () => {
        expect(enCellOf({ name: 'REFUSAL_POLICY_BOOK', en: 'existing key `policyBook`' })).toBe(
            'existing key `policyBook`',
        );
    });

    it('quotes the sentence of the messages file for {line}, so the document keeps no copy', () => {
        const { refusals } = recipeStateMessages.en;

        expect(enCellOf({ name: 'REFUSAL_STATEMENT_REQUIRED', en: '{line}' })).toBe(
            refusals.REFUSAL_STATEMENT_REQUIRED,
        );
        expect(enCellOf({ name: 'REFUSAL_SOURCE_CORRECTED', en: '{line} (planned)' })).toBe(
            `${refusals.REFUSAL_SOURCE_CORRECTED} (planned)`,
        );
    });

    it('throws for {line} on a refusal the messages have no sentence for', () => {
        expect(() => enCellOf({ name: 'REFUSAL_NONE', en: '{line}' })).toThrow(/REFUSAL_NONE/);
    });
});

describe('labelsIn', () => {
    it('fills a {label:KEY} from the messages and leaves other text alone', () => {
        expect(labelsIn('Owner "{label:VIEW_HIDDEN_AFTER_REPORT.owner}" only')).toBe(
            `Owner "${recipeStateMessages.en.labels['VIEW_HIDDEN_AFTER_REPORT.owner']}" only`,
        );
    });

    it('throws on a key the messages do not have, so a drifted cell fails the generator', () => {
        expect(() => labelsIn('{label:publicPage.hiddenOwner}')).toThrow(/publicPage\.hiddenOwner/u);
    });
});

describe('the committed model document (ADR-0105)', () => {
    const doc = readFileSync(new URL('../../../../docs/architecture/recipeStateModel.md', import.meta.url), 'utf8');

    it('names no FORCE_PRIVATE and no forcesPrivate', () => {
        expect(doc).not.toMatch(/FORCE_PRIVATE|forcesPrivate/);
    });

    it('lists the six chips in precedence order, in the sentence and in the table', () => {
        expect(doc).toContain('Draft, Hidden, In review, Checking, Public or Private');

        const table = doc.slice(doc.indexOf('| Chip '), doc.indexOf('Until 020 ships'));
        const names = [...table.matchAll(/^\| (\w[\w ]*?)\s+\|/gm)].map((m) => m[1]).slice(1);

        expect(names).toEqual(['Draft', 'Hidden', 'In review', 'Checking', 'Public', 'Private']);
    });
});
