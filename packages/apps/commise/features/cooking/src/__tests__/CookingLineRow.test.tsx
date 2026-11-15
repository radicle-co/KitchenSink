import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CookingLineRow } from '../CookingLineRow.js';
import type { CookingLineView } from '../cookingViewProps.js';
import { FOCUS_LINE_TYPE } from '../focusLineType.js';

/**
 * One line of a step, as the checkbox the cook ticks. The row is the whole control and is named by the line's text. The
 * focus line takes the focus-line type seam and the other lines the body size, and both set their own reading face, so
 * a face set on the frame or any ancestor cannot reach them. (jsdom computes no inherited font, so the computed face is
 * checked in the browser, not here.)
 */
const lineOf = (over: Partial<CookingLineView> = {}): CookingLineView => ({
    key: '0',
    text: 'Heat 1.5 tbsp. oil.',
    checked: false,
    onToggle: vi.fn(),
    ...over,
});

/** The body face, set on the line itself: a face on the frame or any ancestor (`font-display`) must not reach it. */
const READING_FACE_CLASS = 'font-body';

describe('CookingLineRow', () => {
    it('is a checkbox named by its text, and the whole row is the control', () => {
        const onToggle = vi.fn();
        render(<CookingLineRow line={lineOf({ onToggle })} emphasis="other" />);

        const box = screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' });

        expect(box.tagName).toBe('BUTTON');
        fireEvent.click(box);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('reports its tick state through aria-checked, both ways', () => {
        const { rerender } = render(<CookingLineRow line={lineOf({ checked: false })} emphasis="other" />);

        expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');

        rerender(<CookingLineRow line={lineOf({ checked: true })} emphasis="other" />);

        expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    });

    it('sets the focus line in the focus-line type seam and an other line in the reading body size', () => {
        const { rerender } = render(<CookingLineRow line={lineOf()} emphasis="focus" />);

        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).toContain(FOCUS_LINE_TYPE.webClassName);
        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).not.toContain('text-reading-body');

        rerender(<CookingLineRow line={lineOf()} emphasis="other" />);

        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).toContain('text-reading-body');
        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).not.toContain(FOCUS_LINE_TYPE.webClassName);
    });

    it('sets its own reading face on the line, so no face set above it can reach it', () => {
        const { rerender } = render(<CookingLineRow line={lineOf()} emphasis="focus" />);

        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).toContain(READING_FACE_CLASS);

        rerender(<CookingLineRow line={lineOf()} emphasis="other" />);

        expect(screen.getByText('Heat 1.5 tbsp. oil.').className).toContain(READING_FACE_CLASS);
    });

    it('dims a ticked line to muted ink, never struck through', () => {
        render(<CookingLineRow line={lineOf({ checked: true })} emphasis="other" />);

        const text = screen.getByText('Heat 1.5 tbsp. oil.');

        expect(text.className).toContain('text-ink-muted');
        expect(text.className).not.toContain('line-through');
    });
});
