import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CookingNextPreview } from '../CookingNextPreview.js';
import { SHORT_SCREEN } from '../cookingLayout.js';

/**
 * The next step, previewed in the pinned foot above Back and Next while a line is unticked (board
 * CookingModeStep*). Under 700 tall its line shows on one line; the clamp is visual, so the whole line is still the
 * element's text.
 */
describe('CookingNextPreview', () => {
    const preview = { overline: 'Next · step 3', line: 'Put the chicken in the tin and roast it for twenty minutes.' };

    it('shows the overline, then the next step’s first line, as plain text', () => {
        render(<CookingNextPreview preview={preview} />);

        const overline = screen.getByText('Next · step 3');
        const line = screen.getByText(preview.line);

        expect(overline.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('clamps the line to one line under 700 tall, keeping the whole line as its text', () => {
        render(<CookingNextPreview preview={preview} />);

        const line = screen.getByText(preview.line);

        expect(line.className).toContain(SHORT_SCREEN.previewWebClassName);
        expect(line.textContent).toBe(preview.line);
    });

    it('never clamps the overline', () => {
        render(<CookingNextPreview preview={preview} />);

        expect(screen.getByText('Next · step 3').className).not.toContain('line-clamp');
    });
});
