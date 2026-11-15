import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CookingTopBar } from '../CookingTopBar.js';
import { NARROW_ROW } from '../cookingLayout.js';

/** The top bar: Exit, then the place as plain text. On Done there is no place, only Exit. */
describe('CookingTopBar', () => {
    const exit = { label: 'Exit', accessibilityLabel: 'Exit cooking mode', onPress: vi.fn() };
    const step2 = { text: 'Step 2 of 6', tone: 'ink' } as const;

    it('makes Exit one control with one accessible name that contains its visible label', () => {
        render(<CookingTopBar exit={exit} place={step2} />);

        const buttons = screen.getAllByRole('button');

        expect(buttons).toHaveLength(1);
        expect(buttons[0]?.getAttribute('aria-label')).toBe('Exit cooking mode');
        expect(buttons[0]?.textContent).toContain('Exit');
    });

    it('calls Exit', () => {
        const onPress = vi.fn();
        render(<CookingTopBar exit={{ ...exit, onPress }} place={step2} />);

        fireEvent.click(screen.getByRole('button', { name: 'Exit cooking mode' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('shows the place as plain text, after Exit, with no control role', () => {
        render(<CookingTopBar exit={exit} place={step2} />);

        const place = screen.getByText('Step 2 of 6');
        const button = screen.getByRole('button', { name: 'Exit cooking mode' });

        expect(place.closest('button')).toBeNull();
        expect(button.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('drops the place to its own row under 360, and keeps the Exit label there', () => {
        render(<CookingTopBar exit={exit} place={step2} />);

        expect(screen.getByText('Step 2 of 6').className).toContain(NARROW_ROW.placeWebClassName);
        expect(screen.getByRole('button', { name: 'Exit cooking mode' }).textContent).toContain('Exit');
    });

    it('mutes the place while the recipe loads, and only then', () => {
        const { rerender } = render(<CookingTopBar exit={exit} place={{ text: 'Step –', tone: 'muted' }} />);
        expect(screen.getByText('Step –').className).toContain('text-ink-muted');

        rerender(<CookingTopBar exit={exit} place={{ text: 'Step 1 of 6', tone: 'ink' }} />);
        expect(screen.getByText('Step 1 of 6').className).not.toContain('text-ink-muted');
    });

    it('draws Exit alone where there is no place (Done)', () => {
        const { container } = render(<CookingTopBar exit={exit} />);

        expect(screen.getByRole('button', { name: 'Exit cooking mode' })).toBeTruthy();
        expect(container.querySelector('p')).toBeNull();
    });
});
