import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ProgressBar } from '../ProgressBar.native.js';

/** ProgressBar (native) — a determinate `progressbar` named by its label, its value and bounds exposed. */

afterEach(cleanup);

describe('ProgressBar (native)', () => {
    it('is a progressbar named by its label, with its value and bounds', () => {
        render(<ProgressBar label="Recipes reviewed" value={14} max={309} />);

        const bar = screen.getByRole('progressbar', { name: 'Recipes reviewed' });

        expect(bar.getAttribute('aria-valuenow')).toBe('14');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('309');
    });

    it('fills the share done, clamped to the bar', () => {
        render(<ProgressBar label="Done" value={9} max={4} />);

        const bar = screen.getByRole('progressbar');

        expect(bar.getAttribute('aria-valuenow')).toBe('4');
        expect(getComputedStyle(bar.firstElementChild as HTMLElement).width).toBe('100%');
    });
});
