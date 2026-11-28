/** The dead-class detector: one rule per row, each against a board built by `makeBoard`. */
import { describe, expect, it } from 'vitest';

import { deadClassSelectors } from '../src/deadClassSelectors.js';

import { makeBoard } from './__fixtures__/makeBoard.js';

/** A board with the given `<style>` and body. */
const board = (css: string, body?: string, script?: string): string =>
    makeBoard({ css, ...(body === undefined ? {} : { body }), ...(script === undefined ? {} : { script }) });

describe('deadClassSelectors', () => {
    it('reports a class selector no element carries', () => {
        expect(deadClassSelectors(board('.used{color:red} .ghost{color:blue}'))).toEqual(['ghost']);
    });

    it('reports nothing when every selector class is used', () => {
        expect(deadClassSelectors(board('.used{color:red}'))).toEqual([]);
    });

    it('reads a class inside @media', () => {
        expect(deadClassSelectors(board('@media (min-width:600px){.ghost{color:red}}'))).toEqual(['ghost']);
    });

    it('reads classes inside :is() and :not()', () => {
        expect(deadClassSelectors(board(':is(.used,.ghost){color:red} .used:not(.shade){color:blue}'))).toEqual([
            'ghost',
            'shade',
        ]);
    });

    it('does not read an attribute selector or a content string as a class', () => {
        const css = '[class~=attrOnly]{color:red} .used::after{content:".inString"}';
        expect(deadClassSelectors(board(css))).toEqual([]);
    });

    it('does not read a class name in a keyframe or a declaration value', () => {
        expect(deadClassSelectors(board('@keyframes spin{0%{opacity:0}} .used{animation:spin 1s}'))).toEqual([]);
    });

    it('counts a class set by script as used, the safe direction', () => {
        const html = board('.used{} .byScript{}', '<div class="used"></div>', "el.classList.add('byScript')");
        expect(deadClassSelectors(html)).toEqual([]);
    });

    it('counts a class on any element, among several, as used', () => {
        expect(deadClassSelectors(board('.a{} .b{}', '<p class="x a"></p><i class="b y"></i>'))).toEqual([]);
    });

    it('does not count a class that appears only as visible text or inside <style>', () => {
        expect(deadClassSelectors(board('.word{}', '<p>word</p>'))).toEqual(['word']);
    });

    it('counts a class used only inside a <template> as used', () => {
        expect(
            deadClassSelectors(board('.inTemplate{} .ghost{}', '<template><i class="inTemplate"></i></template>')),
        ).toEqual(['ghost']);
    });

    it('reads every <style> block', () => {
        const html = '<style>.one{}</style><div class="x"></div><style>.two{}</style>';
        expect(deadClassSelectors(html)).toEqual(['one', 'two']);
    });
});
