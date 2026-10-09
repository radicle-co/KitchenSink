/**
 * The native Home "Recent recipes" block, the twin of `RecipeHomeWidget.test.tsx` (`buildSpec.md` §4.2, D8): the heading
 * with "See all", up to four cards in the decided variant, Home's 2 × 2 / one-row-of-four grid, the first run, and the
 * loading and error fallbacks — in both schemes, every colour read from the theme.
 *
 * ⚠️ REWRITTEN for slice 4, with the native per-component tests of the pieces it composes moved here (see the web file).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeWidgetLoadError } from '../../components/RecipeWidgetLoadError.native.js';
import { RecipeWidgetLoadingCard } from '../../components/RecipeWidgetLoadingCard.js';
import RecipeHomeWidget, { type RecipeHomeWidgetProps } from '../RecipeHomeWidget.native.js';

/** The system colour scheme and window width the next render sees. */
const env = vi.hoisted(() => ({ width: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...withSystemScheme(actual),
        useWindowDimensions: () => ({ width: env.width, height: 844, scale: 2, fontScale: 1 }),
    };
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
    env.width = 390;
});

const recipes = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => makeRecipe({ id, title: `Recipe ${id}` }));

function widget(props: Partial<RecipeHomeWidgetProps> = {}) {
    return render(
        <LocaleProvider locale="en">
            <RecipeHomeWidget recipes={recipes} variant="compact" {...props} />
        </LocaleProvider>,
    );
}

describe('RecipeHomeWidget (native) — recent recipes', () => {
    it.each<['light' | 'dark', string]>([
        ['light', role.ink],
        ['dark', roleDark.ink],
    ])('heads the block with "Recent recipes" in the %s ink', (scheme, ink) => {
        systemScheme.current = scheme;
        widget();
        const heading = screen.getByRole('heading', { name: 'Recent recipes' });

        expect(getComputedStyle(heading).color).toBe(rgb(ink));
    });

    it('shows at most four cards, each a link that reports its id', () => {
        const onSelectRecipe = vi.fn();
        widget({ onSelectRecipe });

        expect(screen.getAllByRole('link')).toHaveLength(4);

        fireEvent.click(screen.getByRole('link', { name: 'Recipe r3' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('r3');
    });

    it.each<[number, string]>([
        [390, '48%'],
        [768, '23%'],
    ])('lays a %i-wide window out in Home’s grid (cell width %s)', (width, cell) => {
        env.width = width;
        const { container } = widget();
        const cells = container.querySelectorAll<HTMLElement>('[data-home-cell]');

        expect(cells).toHaveLength(4);
        expect(cells[0]?.style.width || getComputedStyle(cells[0]!).width).toBe(cell);
    });

    it('offers "See all", named "See all recipes"', () => {
        const onPress = vi.fn();
        widget({ seeAll: { onPress } });

        fireEvent.click(screen.getByRole('link', { name: 'See all recipes' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('calls renderNutrition once per card with its own id', () => {
        const renderNutrition = vi.fn((id: string) => <span>{`kcal:${id}`}</span>);
        widget({ variant: 'grid', renderNutrition });

        expect(renderNutrition.mock.calls.map(([id]) => id)).toStrictEqual(['r1', 'r2', 'r3', 'r4']);
    });
});

describe('RecipeHomeWidget (native) — the first run', () => {
    it('offers the three ways in and no "See all"', () => {
        const onCreateRecipe = vi.fn();
        const onPasteIngredients = vi.fn();
        const onFindOnDiscover = vi.fn();
        widget({
            recipes: [],
            seeAll: { onPress: vi.fn() },
            firstRun: { onCreateRecipe, onPasteIngredients, onFindOnDiscover },
        });

        expect(screen.getByText('Your recipes will show up here.')).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'See all recipes' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Add your first recipe' }));
        fireEvent.click(screen.getByRole('button', { name: 'Paste ingredients' }));
        fireEvent.click(screen.getByRole('link', { name: 'Or find one on Discover' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(onPasteIngredients).toHaveBeenCalledTimes(1);
        expect(onFindOnDiscover).toHaveBeenCalledTimes(1);
    });
});

describe('the Home recent block’s own fallbacks (native)', () => {
    it('loading: four skeletons of the variant in use, named for the wait', () => {
        const { container } = render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadingCard variant="compact" />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Recent recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(container.querySelectorAll('[data-skeleton-variant="compact"]')).toHaveLength(4);
    });

    it('load error: says so, with Try again when the host can retry', () => {
        const onRetry = vi.fn();
        render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadError onRetry={onRetry} />
            </LocaleProvider>,
        );

        expect(screen.getByText('We couldn’t load your recent recipes.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
