import { describe, expect, it } from 'vitest';

import { MAX_ELEMENT_DEPTH, parsePage } from '../pageDocument.js';
import { MAX_TOKEN_COMPARISONS, MAX_VISIBLE_NODES, MAX_VISIBLE_TOKENS } from '../pageCaps.js';
import { tokensOf } from '../pageTokens.js';
import { visibleTextOf } from '../visiblePageText.js';
import type { VisibleText } from '../visiblePageText.js';

const visible = (body: string): VisibleText => {
    const result = visibleTextOf(parsePage(`<html><body>${body}</body></html>`));

    if (result.kind !== 'ok') {
        throw new Error(`expected visible text, got ${result.kind}`);
    }

    return result.text;
};

describe('visibleTextOf', () => {
    const text = visible('<ul><li>1 cup flour</li><li>2 eggs, beaten</li></ul><p>Mix 1 cup flour. Then bake.</p>');

    it('finds a run of tokens anywhere, across blocks too', () => {
        expect(text.find(['mix', '1', 'cup', 'flour'], false)).toBe('found');
        expect(text.find(['beaten', 'mix'], false)).toBe('found');
        expect(text.find(['2', 'eggs'], false)).toBe('found');
        expect(text.find(['3', 'eggs'], false)).toBe('absent');
    });

    it('finds a run that must END where a visible block ends', () => {
        expect(text.find(['1', 'cup', 'flour'], true)).toBe('found');
        expect(text.find(['2', 'eggs', 'beaten'], true)).toBe('found');
        expect(text.find(['2', 'eggs'], true)).toBe('absent');
        expect(text.find(['then', 'bake'], true)).toBe('found');
    });

    it('does not read a script, a style or the head as visible', () => {
        const page = parsePage(
            '<html><head><title>head words</title></head><body><script>var script words;</script><p>shown</p></body></html>',
        );
        const result = visibleTextOf(page);

        expect(result.kind === 'ok' && result.text.find(['shown'], true)).toBe('found');
        expect(result.kind === 'ok' && result.text.find(['script', 'words'], false)).toBe('absent');
        expect(result.kind === 'ok' && result.text.find(['head', 'words'], false)).toBe('absent');
    });

    // ⛔ The verification review's probes: text a browser does not draw is no part of the card. Text hidden by a CSS CLASS
    // cannot be seen without the page's stylesheet, so only inline styles and the markup's own hiding are read here.
    it.each([
        ['an inline display:none', '<div style="color: red; DISPLAY : None">secret words</div>'],
        ['an inline visibility:hidden', '<p style="visibility:hidden">secret words</p>'],
        ['a dialog without open', '<dialog><p>secret words</p></dialog>'],
        ['the fallback text of an iframe', '<iframe src="x">secret words</iframe>'],
        ['a noembed', '<noembed>secret words</noembed>'],
        ['an SVG title', '<svg><title>secret words</title><circle r="1"></circle></svg>'],
        ['the inside of a closed details', '<details><summary>More</summary><p>secret words</p></details>'],
    ])('does not read %s as visible', (_label, markup) => {
        const text = visible(`<p>shown</p>${markup}`);

        expect(text.find(['shown'], true)).toBe('found');
        expect(text.find(['secret', 'words'], false)).toBe('absent');
    });

    it.each([
        ['an open dialog', '<dialog open><p>secret words</p></dialog>'],
        ['an open details', '<details open><summary>More</summary><p>secret words</p></details>'],
        ['an inline style that hides nothing', '<p style="display:block">secret words</p>'],
    ])('reads %s as visible', (_label, markup) => {
        expect(visible(markup).find(['secret', 'words'], false)).toBe('found');
    });

    it('reads the summary of a closed details, which the cook sees', () => {
        expect(
            visible('<details><summary>More words</summary><p>secret</p></details>').find(['more', 'words'], true),
        ).toBe('found');
    });

    it('takes the card to be the smallest element holding what was read, even inside a list item of its own', () => {
        // A page that lists recipes: the card is the inner div, so its note and the other recipe's item are not its lines.
        const page = visible(
            '<ul><li><div><ul><li>1 cup flour</li></ul><ol><li>Mix well.</li></ol><p>Keeps a week.</p></div></li><li>Other recipe</li></ul>',
        );
        const card = [
            { runs: [tokensOf('1 cup flour')], wholeBlocks: true },
            { runs: [tokensOf('Mix well.')], wholeBlocks: false },
        ];

        expect(page.shows(card)).toBe('matches');
        expect(
            visible(
                '<div><ul><li>1 cup flour</li></ul><ol><li>Mix well.</li></ol><ol><li>Chill.</li></ol></div>',
            ).shows(card),
        ).toBe('differs');
    });

    it('says there is no body when the paste has none', () => {
        expect(visibleTextOf(parsePage('<html><head><title>t</title></head><p>1 cup flour</p></html>'))).toEqual({
            kind: 'noBody',
        });
    });

    it('says too complex for a page cut for depth, for too many tokens, and for too many nodes', () => {
        const deep = parsePage(`<body>${'<div>'.repeat(MAX_ELEMENT_DEPTH + 10)}1 cup flour</body>`);
        const manyWords = parsePage(`<body><p>${'word '.repeat(MAX_VISIBLE_TOKENS + 1)}</p></body>`);
        const manyNodes = parsePage(`<body>${'<b>x</b>'.repeat(MAX_VISIBLE_NODES)}</body>`);

        expect(visibleTextOf(deep)).toEqual({ kind: 'tooComplex' });
        expect(visibleTextOf(manyWords)).toEqual({ kind: 'tooComplex' });
        expect(visibleTextOf(manyNodes)).toEqual({ kind: 'tooComplex' });
    });

    it('does not try a common first word at every place it occurs: a run starts from its rarest token', () => {
        const steps = Array.from({ length: 4_000 }, (_, index) => `Stir pot ${index}.`);
        const many = visible(steps.map((step) => `<li>${step}</li>`).join(''));

        expect(steps.every((step) => many.find(tokensOf(step), false) === 'found')).toBe(true);
        // ⛔ Work is COUNTED, never timed. From its rarest token each run costs a handful of comparisons; from "stir", which
        // all 4,000 lines start with, it would cost thousands each and run past the page's whole budget.
        expect(many.comparisonsSpent()).toBeLessThanOrEqual(10 * steps.length);
    });

    it('stops comparing once the page has cost its budget, and says so rather than guess', () => {
        const repeated = visible(`<p>${'a '.repeat(60_000)}${'b '.repeat(60_000)}</p>`);
        const answers = new Set<string>();

        for (let ask = 0; ask < 200; ask += 1) {
            answers.add(repeated.find(['b', 'a'], false));
        }

        expect(answers).toEqual(new Set(['absent', 'overBudget']));
        // Once past the budget, an ask costs only the run's own length and one comparison before it answers.
        expect(repeated.comparisonsSpent()).toBeLessThanOrEqual(MAX_TOKEN_COMPARISONS + (2 + 1) * 200);
    });
});

describe('VisibleText.shows: the page shows exactly this list', () => {
    const lines = (...texts: string[]) => texts.map((line) => tokensOf(line));
    const list = (inner: string) => visible(`<h2>Ingredients</h2><ul>${inner}</ul><p>Other text.</p>`);
    const items = (...texts: string[]) => texts.map((line) => `<li>${line}</li>`).join('');

    it('matches the lines of a list, whole, in order, with a heading above', () => {
        expect(
            list(items('1 cup flour', '2 eggs')).shows([{ runs: lines('1 cup flour', '2 eggs'), wholeBlocks: true }]),
        ).toBe('matches');
    });

    it.each([
        ['a line the schema leaves out, last', items('1 cup flour', '2 eggs', '1 tsp salt')],
        ['a line the schema leaves out, first', items('1 tsp salt', '1 cup flour', '2 eggs')],
        ['a line the schema leaves out, between', items('1 cup flour', '1 tsp salt', '2 eggs')],
    ])('differs for %s', (_name, inner) => {
        expect(list(inner).shows([{ runs: lines('1 cup flour', '2 eggs'), wholeBlocks: true }])).toBe('differs');
    });

    it('differs for a run that is only the end, or only the start, of a visible line', () => {
        expect(list(items('2 cups flour')).shows([{ runs: lines('flour'), wholeBlocks: true }])).toBe('differs');
        expect(list(items('1 cup flour, sifted')).shows([{ runs: lines('1 cup flour'), wholeBlocks: true }])).toBe(
            'differs',
        );
    });

    it('differs when the lines are in another order, and for a run that is not there', () => {
        expect(
            list(items('1 cup flour', '2 eggs')).shows([{ runs: lines('2 eggs', '1 cup flour'), wholeBlocks: true }]),
        ).toBe('differs');
        expect(list(items('1 cup flour')).shows([{ runs: lines('9 cups rice'), wholeBlocks: true }])).toBe('differs');
    });

    it('does not take a block it already used for a second, equal line', () => {
        expect(list(items('1 egg', '1 egg')).shows([{ runs: lines('1 egg', '1 egg'), wholeBlocks: true }])).toBe(
            'matches',
        );
        expect(list(items('1 egg')).shows([{ runs: lines('1 egg', '1 egg'), wholeBlocks: true }])).toBe('differs');
    });

    it('never matches a run with no tokens', () => {
        expect(list(items('1 cup flour')).shows([{ runs: [[], ...lines('1 cup flour')], wholeBlocks: true }])).toBe(
            'differs',
        );
    });

    it('lets a line stand over several blocks of one list, as an amount and a name in two cells', () => {
        const text = visible('<div><div>1 cup</div><div>flour</div></div>');

        expect(text.shows([{ runs: lines('1 cup flour'), wholeBlocks: true }])).toBe('matches');
    });

    it('reads another list on the page, in another container, as no part of this one', () => {
        const text = visible(`<ul>${items('1 cup flour')}</ul><ul>${items('Related: pie', 'Related: tart')}</ul>`);

        expect(text.shows([{ runs: lines('1 cup flour'), wholeBlocks: true }])).toBe('matches');
    });

    it('reads a step as any sentence of a block, and the sentences together as the whole block', () => {
        const text = visible('<p>Mix well. Bake it. Serve.</p>');

        expect(text.shows([{ runs: lines('Mix well.', 'Bake it.', 'Serve.'), wholeBlocks: false }])).toBe('matches');
        expect(text.shows([{ runs: lines('Mix well.', 'Serve.'), wholeBlocks: false }])).toBe('differs');
        expect(text.shows([{ runs: lines('Bake it.'), wholeBlocks: false }])).toBe('differs');
    });

    it('stops comparing once the page has cost its budget, and says so', () => {
        const repeated = visible(`<p>${'a '.repeat(60_000)}${'b '.repeat(60_000)}</p>`);
        const answers = new Set<string>();

        for (let ask = 0; ask < 200; ask += 1) {
            answers.add(repeated.shows([{ runs: [['b', 'a']], wholeBlocks: false }]));
        }

        expect(answers.has('overBudget')).toBe(true);
    });
});
