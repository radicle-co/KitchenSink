/**
 * The web icon button: one glyph in a 44 px target, named by the caller. Mutation lens: drop the name and the role row
 * fails; let the target grow with the text and the fixed-class row fails; let the glyph grow and the fixed-glyph row
 * fails; drop the press handler and the press row fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TOUCH_TARGET_CLASS } from '../../touchTarget/touchTargetClass.js';
import { ICON_BUTTON_CLASS, ICON_BUTTON_TONE_CLASS, IconButton } from '../IconButton.js';

afterEach(cleanup);

describe('IconButton (web)', () => {
    it('is a button named by the caller, and the glyph adds no name of its own', () => {
        render(<IconButton icon="pause" accessibilityLabel="Pause Roast timer" onPress={vi.fn()} />);

        const button = screen.getByRole('button', { name: 'Pause Roast timer' });

        expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('reports a press once', () => {
        const onPress = vi.fn();
        render(<IconButton icon="x" accessibilityLabel="Cancel" onPress={onPress} />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('is a fixed 44 px target that never grows with the text', () => {
        render(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />);
        const classes = screen.getByRole('button', { name: 'Cancel' }).className.split(' ');

        expect(classes).toContain(TOUCH_TARGET_CLASS.fixed);
    });

    it('draws a 24 glyph that stays 24 whatever the text size', () => {
        render(<IconButton icon="play" accessibilityLabel="Resume" onPress={vi.fn()} />);
        const svg = screen.getByRole('button', { name: 'Resume' }).querySelector<SVGSVGElement>('svg');

        expect(svg).not.toBeNull();

        expect(svg?.getAttribute('width')).toBe('24');
        expect(svg?.getAttribute('height')).toBe('24');
        expect(svg?.style.width).toBe('');
    });

    it('is a button of type button, so it never submits a form', () => {
        render(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
    });

    // The recipe is shared with controls that keep their own element (a Radix trigger), so its colour is a second,
    // separate class: two colours in one string would leave Tailwind's emission order to pick the winner.
    it('shares a recipe with no colour in it, and a tone class that is one colour', () => {
        expect(ICON_BUTTON_CLASS.split(' ').filter((token) => token.startsWith('text-'))).toEqual([]);
        expect(ICON_BUTTON_TONE_CLASS).toEqual({ ink: 'text-ink', inkMuted: 'text-ink-muted' });
    });

    it('is ink by default, and the muted tone swaps the colour rather than adding one', () => {
        const { rerender } = render(<IconButton icon="x" accessibilityLabel="Close" onPress={vi.fn()} />);
        const ink = screen.getByRole('button', { name: 'Close' }).className.split(' ');

        expect(ink).toContain('text-ink');
        expect(ink).not.toContain('text-ink-muted');

        rerender(<IconButton icon="x" accessibilityLabel="Close" tone="inkMuted" onPress={vi.fn()} />);
        const muted = screen.getByRole('button', { name: 'Close' }).className.split(' ');

        expect(muted).toContain('text-ink-muted');
        expect(muted).not.toContain('text-ink');
    });

    it('is available unless it is told otherwise: no aria-disabled', () => {
        render(<IconButton icon="x" accessibilityLabel="Close" onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('aria-disabled')).toBe(false);
    });

    it('when disabled it refuses the press but stays focusable, and dims to 40% with a not-allowed cursor', () => {
        const onPress = vi.fn();
        render(<IconButton icon="x" accessibilityLabel="Close" disabled onPress={onPress} />);
        const button = screen.getByRole('button', { name: 'Close' });

        fireEvent.click(button);
        button.focus();

        expect(onPress).not.toHaveBeenCalled();
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(button);
        expect(button.className.split(' ')).toEqual(
            expect.arrayContaining(['aria-disabled:opacity-40', 'aria-disabled:cursor-not-allowed']),
        );
        expect(button.className).not.toContain('opacity-60');
    });
});

describe('IconButton (web), a focus request', () => {
    const requested = (focusRequested: boolean, onFocusRequestHandled = vi.fn<() => void>()) => (
        <div>
            <IconButton
                icon="x"
                accessibilityLabel="Cancel"
                onPress={vi.fn()}
                focusRequested={focusRequested}
                onFocusRequestHandled={onFocusRequestHandled}
            />
            <button type="button">Elsewhere</button>
        </div>
    );

    it('moves focus to the button and acknowledges, once', () => {
        const handled = vi.fn<() => void>();
        const { rerender } = render(requested(false, handled));

        expect(document.activeElement).toBe(document.body);

        rerender(requested(true, handled));
        rerender(requested(true, handled));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('takes a request it mounts with', () => {
        const handled = vi.fn<() => void>();
        render(requested(true, handled));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
        expect(handled).toHaveBeenCalledTimes(1);
    });
});
