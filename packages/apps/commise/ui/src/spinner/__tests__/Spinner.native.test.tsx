/** Component tests for the internal native `Spinner`, the busy glyph of `Button`. */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { Spinner } from '../Spinner.native.js';

afterEach(cleanup);

describe('Spinner (native)', () => {
    const boxWidthAt = (scale: number): string => {
        const { container, unmount } = renderWithTamagui(
            <Spinner color="#000000" scaleWith={{ role: 'label' }} />,
            'light',
            scale,
        );
        const box = container.querySelector('[role="progressbar"]')?.parentElement?.parentElement;
        const width = box === null || box === undefined ? '' : resolvedStyle(box, 'width');

        unmount();

        return width;
    };

    it('has a 20 box at 1x that grows with its label to the label cap', () => {
        expect([1, 1.5, 3].map(boxWidthAt)).toEqual(['20px', '30px', '40px']);
    });
});
