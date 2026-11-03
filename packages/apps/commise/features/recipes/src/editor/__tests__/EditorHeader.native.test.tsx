/**
 * The native editor header at large text sizes (designer ruling "fixed frames that hold scaled text", 2026-11-02):
 * only the bar's title may truncate, because the page's H1 repeats it. The save status shows nowhere else, so it wraps
 * to a second line and the bar grows to hold it.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorHeader } from '../EditorHeader.native.js';

/** react-native-web's atomic classes for `numberOfLines`: an ellipsis, a single line, a clamp. */
const CLAMPED = /textOverflow|whiteSpace|LineClamp|line-clamp/;

const STATUS = 'Saved on Monday, 2 November 2026 at 3:41 PM';

/** The inline and class text that makes react-native-web clamp or ellipsize an element. */
const clampOf = (node: HTMLElement): string => `${node.getAttribute('style') ?? ''} ${node.className}`;

const drawHeader = (): void => {
    render(<EditorHeader title="Edit recipe" status={STATUS} closeLabel="Close editor" onClose={() => undefined} />);
};

describe('EditorHeader.native: scaled text', () => {
    afterEach(cleanup);

    it('lets the save status wrap: it carries no line clamp and no ellipsis', () => {
        drawHeader();

        const status = screen.getByText(STATUS);

        expect(clampOf(status)).not.toMatch(CLAMPED);
    });

    it('still lets the bar title truncate, because the H1 repeats it', () => {
        drawHeader();

        const title = screen.getByRole('heading', { name: 'Edit recipe' });

        expect(clampOf(title)).toMatch(CLAMPED);
    });

    it('gives the bar a minimum height and no fixed one, so a second line grows it', () => {
        drawHeader();

        const bar = screen.getByRole('button', { name: 'Close editor' }).parentElement as HTMLElement;

        expect(bar.className).toMatch(/r-minHeight-/);
        expect(bar.className).not.toMatch(/r-height-/);
        expect(bar.getAttribute('style') ?? '').not.toMatch(/(^|[^-])height:\s*\d/);
    });
});
