import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { progressFraction } from '../props.js';
import { ProgressBar } from '../ProgressBar.js';

/**
 * ProgressBar (web) — a determinate `progressbar` named by its label, its value and bounds exposed, its fill the share
 * done; and `progressFraction`, which clamps and never divides by zero.
 */

afterEach(cleanup);

describe('ProgressBar (web)', () => {
    it('is a progressbar named by its label, with its value and bounds', () => {
        render(<ProgressBar label="Review progress" value={14} max={309} />);

        const bar = screen.getByRole('progressbar', { name: 'Review progress' });

        expect(bar.getAttribute('aria-valuenow')).toBe('14');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('309');
    });

    it('fills the share done, clamped to the bar', () => {
        render(<ProgressBar label="Done" value={1} max={4} />);
        expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('25%');
        cleanup();

        render(<ProgressBar label="Done" value={9} max={4} />);
        expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('100%');
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4');
    });
});

describe('progressFraction', () => {
    it.each([
        [0, 10, 0],
        [5, 10, 0.5],
        [10, 10, 1],
        [12, 10, 1],
        [-3, 10, 0],
        [3, 0, 0],
        [3, -1, 0],
        [Number.NaN, 10, 0],
    ])('%d of %d → %d', (value, max, fraction) => {
        expect(progressFraction(value, max)).toBe(fraction);
    });
});
