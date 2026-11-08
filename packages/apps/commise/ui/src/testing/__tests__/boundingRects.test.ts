/**
 * `stubBoundingRects`: the size a test gives an element is the size `getBoundingClientRect` reports, an element the rule
 * does not name keeps jsdom's own (empty) rect, and the restore function puts the original back.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { stubBoundingRects } from '../boundingRects.js';

let restore: (() => void) | undefined;

afterEach(() => {
    restore?.();
    restore = undefined;
    document.body.replaceChildren();
});

describe('stubBoundingRects', () => {
    it('reports the width and height the rule gives an element', () => {
        const wide = document.createElement('div');

        wide.id = 'wide';
        document.body.append(wide);
        restore = stubBoundingRects((element) => (element.id === 'wide' ? { width: 300, height: 36 } : undefined));

        const rect = wide.getBoundingClientRect();

        expect([rect.width, rect.height, rect.right, rect.bottom]).toEqual([300, 36, 300, 36]);
    });

    it('leaves an element the rule does not name with jsdom’s empty rect', () => {
        const other = document.createElement('div');

        document.body.append(other);
        restore = stubBoundingRects(() => undefined);

        expect(other.getBoundingClientRect().width).toBe(0);
    });

    it('defaults the height to 0 and puts the original back on restore', () => {
        const el = document.createElement('div');
        const original = Element.prototype.getBoundingClientRect;

        document.body.append(el);
        const undo = stubBoundingRects(() => ({ width: 10 }));

        expect(el.getBoundingClientRect().height).toBe(0);
        undo();

        expect(Element.prototype.getBoundingClientRect).toBe(original);
        expect(el.getBoundingClientRect().width).toBe(0);
    });
});
