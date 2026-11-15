import { describe, expect, it } from 'vitest';

import { MAX_ELEMENT_DEPTH, parsePage } from '../pageDocument.js';
import { MAX_VISIBLE_NODES, MAX_VISIBLE_TOKENS } from '../pageCaps.js';
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
        const started = performance.now();

        expect(steps.every((step) => many.find(tokensOf(step), false) === 'found')).toBe(true);
        expect(performance.now() - started).toBeLessThan(2_000);
    });

    it('stops comparing once the page has cost its budget, and says so rather than guess', () => {
        const repeated = visible(`<p>${'a '.repeat(60_000)}${'b '.repeat(60_000)}</p>`);
        const started = performance.now();
        const answers = new Set<string>();

        for (let ask = 0; ask < 200; ask += 1) {
            answers.add(repeated.find(['b', 'a'], false));
        }

        expect(answers).toEqual(new Set(['absent', 'overBudget']));
        expect(performance.now() - started).toBeLessThan(5_000);
    });
});
