/** `sideInsetOf` sums the left padding and margin of every ancestor, which is how a test proves a title is inset once. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { sideInsetOf } from '../sideInset.js';

afterEach(cleanup);

describe('sideInsetOf', () => {
    it('is 0 for an element with no padded or margined ancestor', () => {
        render(<p>bare</p>);

        expect(sideInsetOf(screen.getByText('bare'))).toBe(0);
    });

    it('adds the left padding and left margin of each ancestor, and not the element’s own', () => {
        render(
            <div style={{ paddingLeft: '16px' }}>
                <div style={{ marginLeft: '8px', paddingLeft: '4px' }}>
                    <p style={{ paddingLeft: '100px', marginLeft: '100px' }}>nested</p>
                </div>
            </div>,
        );

        expect(sideInsetOf(screen.getByText('nested'))).toBe(28);
    });

    it('ignores the right side', () => {
        render(
            <div style={{ paddingRight: '16px', marginRight: '16px' }}>
                <p>right</p>
            </div>,
        );

        expect(sideInsetOf(screen.getByText('right'))).toBe(0);
    });
});
