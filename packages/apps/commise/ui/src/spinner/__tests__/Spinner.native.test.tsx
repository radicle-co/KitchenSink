/** Component tests for the internal native `Spinner`, the busy glyph of `Button`. */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { IconScaleWith } from '../../icon/props.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { Spinner } from '../Spinner.native.js';

afterEach(cleanup);

describe('Spinner (native)', () => {
    const boxWidthAt = (scale: number, scaleWith: IconScaleWith = { role: 'label' }): string => {
        const { container, unmount } = renderWithTamagui(
            <Spinner color="#000000" scaleWith={scaleWith} />,
            'light',
            scale,
        );
        const box = container.querySelector('[role="progressbar"]')?.parentElement?.parentElement;
        const width = box === null || box === undefined ? '' : resolvedStyle(box, 'width');

        unmount();

        return width;
    };

    it('has a 20 box at 1x that grows with its label to the label cap', () => {
        expect([1, 1.5, 3].map((scale) => boxWidthAt(scale))).toEqual(['20px', '30px', '40px']);
    });

    it('stops at the chrome cap its label states: 26 at 3x under a 1.3 cap', () => {
        expect(boxWidthAt(3, { role: 'label', chromeCap: '1.3' })).toBe('26px');
    });

    it('grows with the role it is given and not a fixed one: a section title stops at 30 at 3x', () => {
        expect(boxWidthAt(3, { role: 'sectionTitle' })).toBe('30px');
    });
});
