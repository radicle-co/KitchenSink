/**
 * The pruner removes the rules a board cannot draw. Each case writes the board's CSS and the CSS that must remain; the
 * board around the `<style>` is the same in both, so a byte outside the removed span cannot change unseen.
 */
import { describe, expect, it } from 'vitest';

import { deadClassSelectors } from '../src/deadClassSelectors.js';
import { pruneBoard, pruneDeadClassRules } from '../src/pruneDeadClassRules.js';

import { makeBoard } from './__fixtures__/makeBoard.js';

const BODY = '<i class="used u2"></i>';

/** The pruned board for this CSS, and the board the pruner must produce from it. */
function pruning(css: string, expected: string): { readonly got: string; readonly want: string } {
    return {
        got: pruneDeadClassRules(makeBoard({ css, body: BODY })),
        want: makeBoard({ css: expected, body: BODY }),
    };
}

function expectPruned(css: string, expected: string): void {
    const { got, want } = pruning(css, expected);

    expect(got).toBe(want);
}

describe('removing a rule', () => {
    it('removes a rule that names a dead class, with its line', () => {
        expectPruned('\n.used{a:b}\n.ghost{c:d}\n.u2{e:f}\n', '\n.used{a:b}\n.u2{e:f}\n');
    });

    it('removes only the dead item of a selector list, first, middle and last', () => {
        expectPruned('.ghost, .used{a:b}', '.used{a:b}');
        expectPruned('.used, .ghost, .u2{a:b}', '.used, .u2{a:b}');
        expectPruned('.used, .ghost{a:b}', '.used{a:b}');
        expectPruned('.ghost, .shade, .used{a:b}', '.used{a:b}');
    });

    it('removes a descendant, a compound, a pseudo-class and a pseudo-element selector on a dead class', () => {
        expectPruned('.used .ghost{a:b}', '');
        expectPruned('.used.ghost{a:b}', '');
        expectPruned('.ghost:hover{a:b}', '');
        expectPruned('.used .ghost::after{a:b}', '');
    });

    it('keeps a :not() on a dead class and reports the class', () => {
        const css = '.used:not(.ghost){a:b}';

        expectPruned(css, css);
        expect(deadClassSelectors(pruneDeadClassRules(makeBoard({ css, body: BODY })))).toEqual(['ghost']);
    });

    it('removes a :is, :where or :has whose every item needs a dead class, and keeps one with a live item', () => {
        expectPruned(':is(.ghost){a:b}', '');
        expectPruned('.used:where(.ghost){a:b}', '');
        expectPruned(':is(.ghost, .shade){a:b}', '');
        expectPruned('.used:has(.ghost){a:b}', '');
        expectPruned(':is(.used, .ghost){a:b}', ':is(.used, .ghost){a:b}');
        expectPruned(':is(.ghost, :not(.shade)){a:b}', ':is(.ghost, :not(.shade)){a:b}');
    });
});

describe('conditional at-rules', () => {
    it('removes a media, container or supports block the prune emptied, nested too', () => {
        expectPruned('@media (min-width:600px){\n.ghost{a:b}\n}', '');
        expectPruned('@container (min-width:600px){.ghost{a:b}}', '');
        expectPruned('@supports (display:grid){@media (min-width:600px){.ghost{a:b}}}', '');
    });

    it('keeps the live rules of a block it only partly emptied', () => {
        expectPruned('@media (min-width:600px){.ghost{a:b}.used{c:d}}', '@media (min-width:600px){.used{c:d}}');
    });

    it('keeps a block that was already empty', () => {
        expectPruned('@media (min-width:600px){}', '@media (min-width:600px){}');
    });

    it('never removes @layer, and never touches @keyframes, @font-face or @import', () => {
        expectPruned('@layer base{.ghost{a:b}}', '@layer base{}');
        expectPruned('@layer a, b;', '@layer a, b;');
        expectPruned('@keyframes spin{0%{opacity:0}}', '@keyframes spin{0%{opacity:0}}');
        expectPruned('@font-face{font-family:x;src:url(x.woff)}', '@font-face{font-family:x;src:url(x.woff)}');
        expectPruned('@import url(x.css);', '@import url(x.css);');
    });
});

describe('what is not a class selector', () => {
    it('leaves an attribute selector and a content string alone', () => {
        const css = '[class~=ghost]{a:b}\n.used::after{content:".ghost"}';

        expectPruned(css, css);
    });
});

describe('comments', () => {
    it('keeps a comment above a removed rule and removes one inside it', () => {
        expectPruned('/* keep */\n.ghost{a:b}\n', '/* keep */\n');
        expectPruned('.ghost{/* inside */a:b}', '');
    });
});

describe('the rest of the board', () => {
    it('prunes every <style>, a <template> one too, and leaves the HTML byte for byte', () => {
        const html = [
            '<style>.ghost{a:b}.used{c:d}</style>',
            '<p class="used u2">  text  </p>',
            '<template><style>.shade{a:b}.u2{c:d}</style></template>',
        ].join('\n');

        expect(pruneDeadClassRules(html)).toBe(
            [
                '<style>.used{c:d}</style>',
                '<p class="used u2">  text  </p>',
                '<template><style>.u2{c:d}</style></template>',
            ].join('\n'),
        );
    });

    it('keeps a class that only a script names, and removes one that is only visible text', () => {
        const html = makeBoard({ css: '.byScript{a:b}\n.word{a:b}\n', body: '<p>word</p>', script: 'x("byScript")' });

        expect(pruneDeadClassRules(html)).toBe(
            makeBoard({ css: '.byScript{a:b}\n', body: '<p>word</p>', script: 'x("byScript")' }),
        );
    });

    it('leaves a <style> whose source differs from its text, and still reports its dead class', () => {
        const html = '<svg><style>.ghost{content:"&amp;"}</style></svg><i class="used"></i>';

        expect(pruneDeadClassRules(html)).toBe(html);
        expect(deadClassSelectors(pruneDeadClassRules(html))).toEqual(['ghost']);
    });

    it('counts the selectors it removed', () => {
        const css = '.ghost, .used{a:b}\n.shade{a:b}\n.u2{a:b}\n';

        expect(pruneBoard(makeBoard({ css, body: BODY })).removed).toBe(2);
    });
});

describe('for every input', () => {
    const inputs: readonly (readonly [css: string, residue: readonly string[]])[] = [
        ['.used{a:b}\n.ghost{a:b}\n', []],
        ['.used:not(.ghost), .ghost, .used .shade{a:b}', ['ghost']],
        ['@media (x){.ghost{a:b}}\n@media (y){.used{a:b}.ghost{c:d}}', []],
        [':is(.ghost, .used) .ghost, .u2{a:b}', []],
        ['.used:has(:not(.ghost)){a:b}\n.ghost:not(.used){a:b}', ['ghost']],
    ];

    it.each(inputs)('is idempotent: %s', (css) => {
        const once = pruneDeadClassRules(makeBoard({ css, body: BODY }));

        expect(pruneDeadClassRules(once)).toBe(once);
    });

    it.each(inputs)('leaves exactly the classes it keeps a selector for: %s', (css, residue) => {
        expect(deadClassSelectors(pruneDeadClassRules(makeBoard({ css, body: BODY })))).toEqual(residue);
    });
});
