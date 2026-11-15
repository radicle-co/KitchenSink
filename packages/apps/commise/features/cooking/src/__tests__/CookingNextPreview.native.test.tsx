/**
 * The native Next preview: the next step's first line, pinned in the foot above Back and Next while a line of this step is
 * unticked. On a short screen (under 700 tall) the line shows on one line, ending in an ellipsis; the cut is visual only,
 * so the whole line stays in the text a screen reader reads. The screen says whether the screen is short (`short`),
 * because a leaf never reads the device.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CookingNextPreview, type NativeCookingNextPreviewProps } from '../CookingNextPreview.native.js';

afterEach(cleanup);

const LINE = 'Slice the lemon thinly, crush the garlic under the flat of a knife, and lay both over the chicken.';

function previewProps(overrides: Partial<NativeCookingNextPreviewProps> = {}): NativeCookingNextPreviewProps {
    return { preview: { overline: 'Next · step 3', line: LINE }, short: false, ...overrides };
}

describe('CookingNextPreview (native)', () => {
    it('shows the overline and the next step’s line as plain text, never a control', () => {
        render(<CookingNextPreview {...previewProps()} />);

        expect(screen.getByText('Next · step 3')).toBeTruthy();
        expect(screen.getByText(LINE)).toBeTruthy();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('cuts the line to one line on a short screen, and keeps the whole line in its text', () => {
        const { unmount } = render(<CookingNextPreview {...previewProps()} />);
        const tall = getComputedStyle(screen.getByText(LINE));
        const tallWhiteSpace = tall.whiteSpace;
        const tallOverflow = tall.textOverflow;
        unmount();

        render(<CookingNextPreview {...previewProps({ short: true })} />);
        const line = screen.getByText(LINE);
        const short = getComputedStyle(line);

        expect(short.textOverflow).toBe('ellipsis');
        expect(tallOverflow).not.toBe('ellipsis');
        expect(short.whiteSpace).not.toBe(tallWhiteSpace);
        expect(line.textContent).toBe(LINE);
    });
});
