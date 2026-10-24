import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { overlayKind } from '../overlayKind.js';

const { document } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }).window;

function div(init: { className?: string; id?: string; popper?: boolean }): HTMLElement {
    const node = document.createElement('div');

    node.className = init.className ?? '';
    node.id = init.id ?? '';

    if (init.popper === true) {
        node.setAttribute('data-radix-popper-content-wrapper', '');
    }

    return node;
}

describe('overlayKind', () => {
    it.each<[string, () => Element, 'web' | 'native' | 'none']>([
        ['a Radix layer by class', () => div({ className: 'fixed inset-0 z-50' }), 'web'],
        ['a Radix layer by id', () => div({ id: 'radix-:r1:' }), 'web'],
        ['a bare div (react-native-web modal)', () => div({}), 'native'],
        ['a popper wrapper', () => div({ popper: true }), 'none'],
        ['a div with a class', () => div({ className: 'x' }), 'none'],
        ['a div with an id that is not radix', () => div({ id: 'app' }), 'none'],
        ['an id that merely contains radix-', () => div({ id: 'not-radix-1' }), 'none'],
        ['a non-div', () => document.createElement('span'), 'none'],
    ])('classifies %s as %s', (_name, make, expected) => {
        expect(overlayKind(make())).toBe(expected);
    });
});
