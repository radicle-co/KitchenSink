/**
 * Native component tests for `ImportReviewRail`, rendered through react-native-web under jsdom. Mirrors
 * `ImportReviewRail.test.tsx`.
 */
import { touchFloor } from '@commise/ui/layout';
import { withPlatformOs } from '@commise/ui/testing/platform-os';
import { themeFor } from '@commise/ui/theme';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportReviewRail } from '../ImportReviewRail.native.js';
import { importMessages } from '../messages.js';

const r = importMessages.en.wizard.rail;

afterEach(cleanup);

const RECIPES = [
    { id: 'beef', title: 'Beef stew', skipped: false },
    { id: 'blondies', title: 'Blondies', skipped: true },
    { id: 'lemon', title: 'Lemon drizzle cake', skipped: false },
];

describe('ImportReviewRail (native)', () => {
    it('lists the recipes, marks the current and the skipped, counts the rest, and opens a recipe', () => {
        const onOpenRecipe = vi.fn();
        render(
            <ImportReviewRail
                total={309}
                recipes={RECIPES}
                currentId="lemon"
                addedWithoutStep={546}
                onOpenRecipe={onOpenRecipe}
            />,
        );

        expect(screen.getByRole('navigation', { name: r.label })).toBeTruthy();
        expect(screen.getByText('309 recipes to review')).toBeTruthy();

        const buttons = screen.getAllByRole('button');

        expect(buttons.map((button) => button.textContent)).toEqual([
            'Beef stew',
            'Blondies\u00A0· skipped',
            'Lemon drizzle cake',
        ]);
        expect(buttons.map((button) => button.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
        expect(screen.getByText('546 more needed nothing from you and are already in.')).toBeTruthy();

        fireEvent.click(buttons[0] as HTMLElement);

        expect(onOpenRecipe).toHaveBeenCalledWith('beef');
    });

    it.each(['ios', 'android'] as const)('every recipe row keeps the touch floor on %s', (os) => {
        withPlatformOs(os, () => {
            render(
                <ImportReviewRail
                    total={309}
                    recipes={RECIPES}
                    currentId="lemon"
                    addedWithoutStep={0}
                    onOpenRecipe={vi.fn()}
                />,
            );

            for (const row of screen.getAllByRole('button')) {
                expect(getComputedStyle(row).minHeight).toBe(`${String(touchFloor())}px`);
            }
        });
    });

    // U10: the current recipe pairs the selected fill (1.2:1 on the paper, under WCAG 1.4.11's 3:1) with a 2 pt
    // selected-edge ring; every row draws the ring's width, clear at rest, so marking a row never moves it.
    it('marks the current recipe with the selected-edge ring as well as the fill; the others draw it clear', () => {
        render(
            <ImportReviewRail
                total={309}
                recipes={RECIPES}
                currentId="lemon"
                addedWithoutStep={0}
                onOpenRecipe={vi.fn()}
            />,
        );

        const hex = themeFor('light').colors.selectedEdge;
        const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
        const styles = screen.getAllByRole('button').map((row) => getComputedStyle(row));

        expect(styles.map((style) => style.borderTopWidth)).toEqual(['2px', '2px', '2px']);
        expect(styles.map((style) => style.borderTopColor)).toEqual([
            'rgba(0, 0, 0, 0)',
            'rgba(0, 0, 0, 0)',
            `rgb(${String(red)}, ${String(green)}, ${String(blue)})`,
        ]);
    });
});
