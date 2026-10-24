/**
 * Where Discover's facets live (`docs/architecture/uiOverhaulBlueprint.md` Part C, slice 5): a sticky panel when the
 * content is at least 960 wide AND the window is not short, otherwise the sheet. Asserted from both directions on both
 * inputs, so a rule that ignored either one fails.
 */
import { describe, expect, it } from 'vitest';

import { filterPresentationOf } from '../filterPresentation.js';

describe('filterPresentationOf', () => {
    it('gives a wide container a panel when the window is tall enough', () => {
        expect(filterPresentationOf('wide', false)).toBe('panel');
    });

    it('gives a wide container the sheet when the window is short (a phone held sideways)', () => {
        expect(filterPresentationOf('wide', true)).toBe('sheet');
    });

    it('gives a container narrower than 960 the sheet however tall the window is', () => {
        expect(filterPresentationOf('regular', false)).toBe('sheet');
        expect(filterPresentationOf('narrow', false)).toBe('sheet');
    });
});
