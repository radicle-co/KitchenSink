/**
 * The native Home "Recent recipes" block, the twin of `RecipeHomeWidget.test.tsx` (`buildSpec.md` §4.2, D8): the heading
 * with "See all", up to four cards in the decided variant, Home's 2 × 2 / one-row-of-four grid, the first run, and the
 * loading and error fallbacks — in both schemes, every colour read from the theme.
 *
 * ⚠️ REWRITTEN for slice 4, with the native per-component tests of the pieces it composes moved here (see the web file).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';
import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeWidgetLoadError } from '../../components/RecipeWidgetLoadError.native.js';
import { RecipeWidgetLoadingCard } from '../../components/RecipeWidgetLoadingCard.js';
import RecipeHomeWidget, { type RecipeHomeWidgetProps } from '../RecipeHomeWidget.native.js';
import { render } from '@commise/ui/testing/tamagui';

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

    // Design review 2026-11-01 (`deviceShots2.md`, Low): at large text "Recent recipes" wrapped beside "See all". The
    // heading row WRAPS rather than squeezing, so when the two do not fit on one line "See all" drops under the title,
    // at the start, and the title keeps the width; when they fit, they share the line, the title first. ⚠️ jsdom lays
    // nothing out, so this reads the row's wrap rule and the order; only a device shows which line "See all" lands on.
    it('wraps the heading row, title first, so "See all" drops under the title when the two do not fit', () => {
        widget({ seeAll: { onPress: vi.fn() } });

        const heading = screen.getByRole('heading', { name: 'Recent recipes' });
        const seeAll = screen.getByRole('link', { name: 'See all recipes' });
        const row = heading.parentElement!;
        const style = getComputedStyle(row);

        expect(row.contains(seeAll)).toBe(true);
        expect(style.flexDirection).toBe('row');
        expect(style.flexWrap).toBe('wrap');
        expect(heading.compareDocumentPosition(seeAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // Designer ruling 2026-11-01 (`nativeBoards/designAnswers.md`, "See all" under its title): wrapped, the link's TEXT
    // lines up with the title's start edge, its target stays at least 48 tall, and any side padding sits at the END.
    // The padding is the same in both layouts: beside the title the row's space-between pins the link's box to the end,
    // so its text does not move. The END, not "the right", so it mirrors in a right-to-left layout (as ProfileFactRow).
    // ⚠️ These read the padding values only; that the wrapped text meets the title's edge shows only on a device.
    it('pads "See all" at its end only, so its text starts where the title does when it wraps, 48 tall', () => {
        widget({ seeAll: { onPress: vi.fn() } });

        const style = getComputedStyle(screen.getByRole('link', { name: 'See all recipes' }));

        // react-native-web emits `paddingEnd` as a logical class, which jsdom resolves left-to-right.
        expect(style.paddingLeft).toBe('0px');
        expect(style.paddingRight).toBe(`${String(nativeTokens.spacing[3])}px`);
        expect(style.minHeight).toBe('48px');
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

    // Design review `mergedUiAndroid2.md` (Home load error): Try again was bare text; `buildSpec.md` §4.2 makes it the
    // design system's secondary button, outlined, with a 44 pt target. The Button also caps its label at 2x.
    it('load error: draws Try again as the secondary button, outlined, with a 44 pt target', () => {
        render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadError onRetry={vi.fn()} />
            </LocaleProvider>,
        );
        const surfaces = [
            screen.getByRole('button', { name: 'Try again' }),
            ...screen.getByRole('button', { name: 'Try again' }).querySelectorAll('*'),
        ];

        expect(surfaces.some((el) => getComputedStyle(el).borderTopWidth === '1px')).toBe(true);
        expect(surfaces.some((el) => Number.parseFloat(getComputedStyle(el).minHeight) >= 44)).toBe(true);
    });

    // Design review 2026-11-01 (`deviceShots2.md` M-3): an error state needs its action in view, so Try again is the
    // element straight after the message, in the same announced region — nothing may come between them.
    it('load error: puts Try again directly under the message, in the same status region', () => {
        render(
            <LocaleProvider locale="en">
                <RecipeWidgetLoadError onRetry={vi.fn()} seeAll={{ onPress: vi.fn() }} />
            </LocaleProvider>,
        );

        const status = screen.getByRole('status');
        const message = within(status).getByText('We couldn’t load your recent recipes.');
        const retry = within(status).getByRole('button', { name: 'Try again' });

        expect(message.nextElementSibling?.contains(retry)).toBe(true);
    });
});
