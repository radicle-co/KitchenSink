import { describe, expect, it } from 'vitest';

import { nearestAncestorHolding } from '../ancestorHolding.js';

/** Build `<outer><inner><from/></inner><held/></outer>` and return the parts. */
function tree(): { outer: HTMLElement; inner: HTMLElement; from: HTMLElement; held: HTMLElement } {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    const from = document.createElement('button');
    const held = document.createElement('h2');

    inner.append(from);
    outer.append(inner, held);

    return { outer, inner, from, held };
}

describe('nearestAncestorHolding', () => {
    it('returns the nearest ancestor of the start that also holds the other element', () => {
        const { outer, from, held } = tree();

        expect(nearestAncestorHolding(from, held, 'the row')).toBe(outer);
    });

    it('returns the nearer box when two ancestors hold it', () => {
        const { outer, inner, from } = tree();
        const alsoInner = document.createElement('span');

        inner.append(alsoInner);

        expect(nearestAncestorHolding(from, alsoInner, 'the row')).toBe(inner);
        expect(outer.contains(inner)).toBe(true);
    });

    it('does not return the start itself', () => {
        const { outer, from } = tree();
        const child = document.createElement('i');

        from.append(child);

        expect(nearestAncestorHolding(from, child, 'the row')).not.toBe(from);
        expect(nearestAncestorHolding(from, child, 'the row')).toBe(from.parentElement);
        expect(outer).toBeDefined();
    });

    it('names what it was looking for when no ancestor holds the other element', () => {
        const { from } = tree();
        const stranger = document.createElement('p');

        expect(() => nearestAncestorHolding(from, stranger, 'the title row')).toThrow(
            'Expected an ancestor of the start to hold the title row.',
        );
    });
});
