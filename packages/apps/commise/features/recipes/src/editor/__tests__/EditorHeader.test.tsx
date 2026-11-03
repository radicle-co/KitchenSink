/**
 * The web editor header at large text sizes: only the title may truncate (the H1 repeats it); the save status shows
 * nowhere else, so it wraps, and the bar has a minimum height, not a fixed one, so it grows to hold it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorHeader } from '../EditorHeader';

const STATUS = 'Saved on Monday, 2 November 2026 at 3:41 PM';

const drawHeader = (): void => {
    render(<EditorHeader title="Edit recipe" status={STATUS} closeLabel="Close editor" onClose={() => undefined} />);
};

describe('EditorHeader (web): scaled text', () => {
    afterEach(cleanup);

    it('does not truncate the save status', () => {
        drawHeader();

        expect(screen.getByText(STATUS).className).not.toMatch(/\btruncate\b|line-clamp/);
    });

    it('sets the status in the meta size, never the title size', () => {
        drawHeader();

        const status = screen.getByText(STATUS).className;

        expect(status).toMatch(/\btext-meta\b/);
        expect(status).not.toMatch(/text-bar-title/);
    });

    it('still lets the title truncate', () => {
        drawHeader();

        expect(screen.getByRole('heading', { name: 'Edit recipe' }).className).toMatch(/\btruncate\b/);
    });

    it('grows with its content: a minimum height, no fixed one', () => {
        drawHeader();

        const bar = screen.getByRole('banner');

        expect(bar.className).toMatch(/\bmin-h-14\b/);
        expect(bar.className).not.toMatch(/(^|\s)h-14\b/);
    });
});
