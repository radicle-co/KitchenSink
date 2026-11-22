/**
 * The web icon button: one glyph in a 44 px target, named by the caller. Mutation lens: drop the name and the role
 * row fails; let the target grow with the text and the fixed-class row fails; let the glyph grow and the fixed-glyph row
 * fails; drop the press handler and the press row fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TOUCH_TARGET_CLASS } from '../../touchTarget/touchTargetClass.js';
import { IconButton } from '../IconButton.js';

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
        const svg = screen.getByRole('button', { name: 'Resume' }).querySelector('svg') as SVGSVGElement;

        expect(svg.getAttribute('width')).toBe('24');
        expect(svg.getAttribute('height')).toBe('24');
        expect(svg.style.width).toBe('');
    });

    it('is a button of type button, so it never submits a form', () => {
        render(<IconButton icon="x" accessibilityLabel="Cancel" onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
    });
});
