import { buttonSurfaceClass } from '@commise/ui/button';
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

        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Exit cooking mode' }).textContent).toContain('Exit');
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
    describe('the Ingredients button', () => {
        const ingredients = { label: 'Ingredients', onPress: vi.fn() };

        it('draws no Ingredients button while the screen gives none (L2, L3, or no ingredients)', () => {
            render(<CookingTopBar exit={exit} place={step2} />);

            expect(screen.queryByRole('button', { name: 'Ingredients' })).toBeNull();
            expect(screen.getAllByRole('button')).toHaveLength(1);
        });

        it('draws one quiet md button named by its label, with the listChecks glyph, and calls it once', () => {
            const onPress = vi.fn();

            render(<CookingTopBar exit={exit} place={step2} ingredients={{ ...ingredients, onPress }} />);

            const button = screen.getByRole('button', { name: 'Ingredients' });

            expect(screen.getAllByRole('button')).toHaveLength(2);
            expect(button.className).toContain(buttonSurfaceClass('quiet'));
            expect(button.querySelector('svg')?.getAttribute('class')).toContain('list-checks');

            fireEvent.click(button);

            expect(onPress).toHaveBeenCalledTimes(1);
        });

        it('keeps one tree: Exit, Ingredients, then the place, with the wide order and the end alignment on a wrapper', () => {
            render(<CookingTopBar exit={exit} place={step2} ingredients={ingredients} />);

            const exitButton = screen.getByRole('button', { name: 'Exit cooking mode' });
            const button = screen.getByRole('button', { name: 'Ingredients' });
            const place = screen.getByText('Step 2 of 6');

            expect(exitButton.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(button.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            // The house Button takes no class, so a wrapper carries the order and the alignment.
            expect(button.closest('div')?.className).toBe(NARROW_ROW.ingredientsWebClassName);
        });

        it('draws Exit and Ingredients where there is no place (Done)', () => {
            render(<CookingTopBar exit={exit} ingredients={ingredients} />);

            expect(screen.getAllByRole('button')).toHaveLength(2);
        });
    });
});
