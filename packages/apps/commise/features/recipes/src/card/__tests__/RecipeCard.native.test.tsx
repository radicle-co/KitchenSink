/**
 * The native recipe card's three variants (`docs/design/uiOverhaul/buildSpec.md` §4.1), rendered through
 * react-native-web: the same invariants as the web leaf — one control named by the title, a decorative cover, no
 * fabricated difficulty or rating, a level-1 card that is never glass (owner ruling D12) — plus the theme: every colour
 * is read from `useTheme()` at render, so the card follows the system scheme (D15).
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul, with `RecipeCard.glass.native.test.tsx` deleted: D12 takes glass off
 * cards. The iOS shadow-clipping invariants (shadow and clip never on one node) are kept, because the level-1 card
 * still elevates and still clips its cover.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { CardVariant } from '../cardVariant.js';
import { toRecipeCardModel } from '../model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCard } from '../RecipeCard.native.js';

/** The OS font scale the card reads through `useWindowDimensions` (A-028: Android's largest setting is 2.0). */
const fontScale = vi.hoisted(() => ({ current: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...withSystemScheme(actual),
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: fontScale.current }),
    };
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
    fontScale.current = 1;
});

const model = (over: Parameters<typeof makeRecipe>[0] = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);
const VARIANTS: readonly CardVariant[] = ['grid', 'row', 'compact'];

const domNodes = (container: HTMLElement): readonly HTMLElement[] => [...container.querySelectorAll<HTMLElement>('*')];
const shadowed = (container: HTMLElement): readonly HTMLElement[] =>
    domNodes(container).filter((node) => window.getComputedStyle(node).boxShadow !== '');
const clipping = (container: HTMLElement): readonly HTMLElement[] =>
    domNodes(container).filter((node) => window.getComputedStyle(node).overflowX === 'hidden');

describe.each(VARIANTS)('RecipeCard (native, %s) — what every variant keeps', (variant) => {
    it('shows the title', () => {
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
    });

    it('keeps the cover photo out of the accessibility tree', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ coverPhotoUrl: 'https://cdn/x.jpg', ratingCount: 0 })}
            />,
        );

        const cover = container.querySelector('img[src="https://cdn/x.jpg"]');
        expect(cover?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('is ONE link named by the title when actionable, reporting the recipe id', () => {
        const onSelect = vi.fn();
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ id: 'rec_42', title: 'Herb Risotto' })}
                onSelect={onSelect}
            />,
        );

        const links = screen.getAllByRole('link', { name: 'Herb Risotto' });
        expect(links).toHaveLength(1);
        expect(screen.queryAllByLabelText('Herb Risotto')).toHaveLength(1);

        fireEvent.click(links[0]!);

        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });

    it('is inert with no onSelect', () => {
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model()} />);

        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('names the PRO badge for a premium recipe only', () => {
        const { unmount } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} recipe={model({ usesPremiumCapability: true })} />,
        );

        expect(screen.getByLabelText('Premium recipe')).toBeTruthy();
        unmount();
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByLabelText('Premium recipe')).toBeNull();
    });

    it.each<['light' | 'dark', string, string]>([
        ['light', role.paper, role.lineDivider],
        ['dark', roleDark.paper, roleDark.lineDivider],
    ])('is a %s level-1 card: paper with a divider hairline, never glass', (name, paper, divider) => {
        systemScheme.current = name;
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} recipe={model({ title: 'Soup' })} />,
        );
        const shell = shadowed(container)[0]!;

        expect(getComputedStyle(shell).backgroundColor).toBe(rgb(paper));
        expect(getComputedStyle(shell).borderTopColor).toBe(rgb(divider));
        expect(container.innerHTML).not.toMatch(/backdrop-filter/u);
    });

    it.each<['light' | 'dark', string]>([
        ['light', role.ink],
        ['dark', roleDark.ink],
    ])('draws the %s title in ink', (name, ink) => {
        systemScheme.current = name;
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ title: 'Soup' })} />);

        expect(getComputedStyle(screen.getByText('Soup')).color).toBe(rgb(ink));
    });

    it('elevates ONE node, which never clips, and clips the cover inside it (iOS masks a co-located shadow)', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ coverPhotoUrl: 'https://cdn/x.jpg' })}
                onSelect={vi.fn()}
            />,
        );
        const elevated = shadowed(container);

        expect(elevated).toHaveLength(1);
        expect(getComputedStyle(elevated[0]!).overflowX).not.toBe('hidden');

        for (const node of clipping(container)) {
            expect(getComputedStyle(node).boxShadow).toBe('');
        }

        expect(clipping(container).some((node) => elevated[0]!.contains(node) && node.querySelector('img'))).toBe(true);
    });
});

describe('RecipeCard (native, grid)', () => {
    it('chips the cover with Draft and the time in hours and minutes', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ status: RecipeStatus.DRAFT, totalTimeMinutes: 330 })}
            />,
        );

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.getByLabelText('330 minutes total time')).toBeTruthy();
        expect(screen.getByText('5 h 30 min')).toBeTruthy();
    });

    it('says the stated difficulty, and nothing when none was stated', () => {
        const { unmount } = renderCard(
            <RecipeCard headingLevel={3} variant="grid" recipe={model({ difficulty: RecipeDifficulty.HARD })} />,
        );

        expect(screen.getByText('Hard')).toBeTruthy();
        unmount();
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ difficulty: undefined })} />);

        expect(screen.queryByText('Hard')).toBeNull();
    });

    it('names a rated recipe’s stars with the short figure, and says an unrated one has none', () => {
        const { unmount } = renderCard(
            <RecipeCard headingLevel={3} variant="grid" recipe={model({ averageRating: 4.75, ratingCount: 12 })} />,
        );

        expect(screen.getByRole('img', { name: 'Rated 4.8 out of 5, 12 ratings' })).toBeTruthy();
        expect(screen.getByText('4.8 (12)')).toBeTruthy();
        unmount();
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('No ratings yet')).toBeTruthy();
    });

    it.each<['light' | 'dark', string]>([
        ['light', role.rating],
        ['dark', roleDark.rating],
    ])('fills the %s stars in the rating role', (name, rating) => {
        systemScheme.current = name;
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ averageRating: 5, ratingCount: 1 })} />);
        const star = screen.getByRole('img', { name: /Rated/u }).querySelector('div, span');

        expect(star === null ? '' : getComputedStyle(star).color).toBe(rgb(rating));
    });

    it('renders the cuisine, the nutrition slot, the servings, the tags line and the footer', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({
                    cuisine: 'Moroccan',
                    servings: 8,
                    tags: ['a', 'b', 'c'],
                    currentVersion: 3,
                    createdAt: '2020-01-01T00:00:00.000Z',
                    updatedAt: '2020-01-02T00:00:00.000Z',
                })}
                nutrition={<span>612 cal</span>}
            />,
        );

        expect(screen.getByText('Moroccan')).toBeTruthy();
        expect(screen.getByText('612 cal')).toBeTruthy();
        expect(screen.getByText('Serves 8')).toBeTruthy();
        expect(screen.getByText('a · b · +1')).toBeTruthy();
        expect(screen.getByText(/^v3 · Edited /u)).toBeTruthy();
    });
});

describe('RecipeCard (native, row)', () => {
    it.each<[RecipeVisibility, string]>([
        [RecipeVisibility.PRIVATE, 'Private'],
        [RecipeVisibility.PUBLIC, 'Public'],
    ])('draws a published %s recipe’s visibility as a named glyph', (visibility, name) => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ status: RecipeStatus.PUBLISHED, visibility })}
            />,
        );

        expect(screen.getByLabelText(name)).toBeTruthy();
        expect(screen.queryByText(name)).toBeNull();
    });

    it('drops the tags and the version', () => {
        renderCard(
            <RecipeCard headingLevel={3} variant="row" recipe={model({ tags: ['vegan'], currentVersion: 9 })} />,
        );

        expect(screen.queryByText(/vegan/u)).toBeNull();
        expect(screen.queryByText(/v9/u)).toBeNull();
    });
});

describe('RecipeCard (native, compact)', () => {
    it('is the cover and the title only', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                recipe={model({ cuisine: 'Thai', averageRating: 4, ratingCount: 2 })}
            />,
        );

        expect(screen.queryByText('Thai')).toBeNull();
        expect(screen.queryByRole('img', { name: /Rated/u })).toBeNull();
    });
});

describe('RecipeCard (native) — slots for a surface’s own controls', () => {
    it.each(['grid', 'compact'] as const)(
        'draws a %s footer whose control is NOT inside the card’s link',
        (variant) => {
            const onSelect = vi.fn();
            const onCopy = vi.fn();
            renderCard(
                <RecipeCard
                    headingLevel={3}
                    variant={variant}
                    recipe={model({ id: 'rec_1', title: 'Herb Risotto' })}
                    onSelect={onSelect}
                    footer={
                        <button type="button" onClick={onCopy}>
                            Save a copy of Herb Risotto
                        </button>
                    }
                />,
            );
            const link = screen.getByRole('link', { name: 'Herb Risotto' });
            const control = screen.getByRole('button', { name: 'Save a copy of Herb Risotto' });

            expect(link.contains(control)).toBe(false);

            fireEvent.click(control);

            expect(onCopy).toHaveBeenCalledOnce();
            expect(onSelect).not.toHaveBeenCalled();
        },
    );

    it('replaces the own-recipe footer in the grid card', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ title: 'Herb Risotto', currentVersion: 12 })}
                footer={<span>@braise.club</span>}
            />,
        );

        expect(screen.getByText('@braise.club')).toBeTruthy();
        expect(screen.queryByText(/v12/u)).toBeNull();
    });

    it('draws a row’s note inside the link and its trailing control outside it', () => {
        const onSelect = vi.fn();
        const onMenu = vi.fn();
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ title: 'Herb Risotto' })}
                onSelect={onSelect}
                note={<span>Added by you</span>}
                trailing={
                    <button type="button" onClick={onMenu}>
                        More actions for Herb Risotto
                    </button>
                }
            />,
        );
        const link = screen.getByRole('link', { name: 'Herb Risotto' });
        const menu = screen.getByRole('button', { name: 'More actions for Herb Risotto' });

        expect(link.contains(screen.getByText('Added by you'))).toBe(true);
        expect(link.contains(menu)).toBe(false);

        fireEvent.click(menu);

        expect(onMenu).toHaveBeenCalledOnce();
        expect(onSelect).not.toHaveBeenCalled();
    });
});

/** Report a laid-out size to every view that asked for one, the way react-native-web's ResizeObserver does. */
function layOutAll(container: HTMLElement, height: number): void {
    for (const node of container.querySelectorAll<HTMLElement>('*')) {
        const handler = (node as HTMLElement & { __reactLayoutHandler?: (event: unknown) => void })
            .__reactLayoutHandler;

        if (handler !== undefined) {
            act(() => handler({ nativeEvent: { layout: { x: 0, y: 0, width: height, height } } }));
        }
    }
}

describe('RecipeCard (native, row) — A-016: the member row keeps its text beside a trailing control', () => {
    it('gives the link the row’s free width, so the title and meta are not squeezed to nothing', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ title: 'Herb Risotto', cuisine: 'Italian' })}
                onSelect={vi.fn()}
                note={<span>Added by you</span>}
                trailing={<button type="button">More actions for Herb Risotto</button>}
            />,
        );
        const link = screen.getByRole('link', { name: 'Herb Risotto' });
        const box = link.parentElement as HTMLElement;

        expect(link.contains(screen.getByText('Herb Risotto'))).toBe(true);
        expect(link.contains(screen.getByText('Added by you'))).toBe(true);
        // `PressScale fill` is `alignSelf: stretch`, which in a ROW stretches height, not width: the box must carry the
        // free width, with `minWidth: 0` so a long title wraps instead of widening the row.
        expect(getComputedStyle(box).flexGrow).toBe('1');
        expect(getComputedStyle(box).minWidth).toBe('0px');
    });
});

describe('RecipeCard (native) — W-06 / A-028: a one-line row is exactly one line, at any font scale', () => {
    const metaLineOf = (text: string): HTMLElement => screen.getByText(text).parentElement as HTMLElement;
    // A badge is a view holding its meter and its word, and the line holds the badge.
    const badgeLineOf = (text: string): HTMLElement => metaLineOf(text).parentElement as HTMLElement;

    it('is as tall as the meta line (19.6 pt, rounded up), so a dropped item leaves no sliver under it', () => {
        renderCard(<RecipeCard headingLevel={3} variant="row" recipe={model({ cuisine: 'Moroccan' })} />);

        expect(getComputedStyle(metaLineOf('Moroccan')).height).toBe('20px');
    });

    it('scales with the OS font scale, so the largest setting clips neither the text nor the badge', () => {
        fontScale.current = 2;
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ cuisine: 'Moroccan', difficulty: RecipeDifficulty.EASY })}
            />,
        );

        expect(getComputedStyle(metaLineOf('Moroccan')).height).toBe('40px');
        // The badge line also holds the rating's meta text, which is taller than the badge's word at this scale.
        expect(getComputedStyle(badgeLineOf('Easy')).height).toBe('40px');
    });

    it('keeps the 24 pt badge line at the default scale', () => {
        renderCard(<RecipeCard headingLevel={3} variant="row" recipe={model({ difficulty: RecipeDifficulty.EASY })} />);

        expect(getComputedStyle(badgeLineOf('Easy')).height).toBe('24px');
    });

    it('caps the cuisine at half the line, so it truncates before the time and the servings drop', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ cuisine: 'Mediterranean', totalTimeMinutes: 90 })}
            />,
        );

        expect(getComputedStyle(screen.getByText('Mediterranean')).maxWidth).toBe('50%');
    });
});

describe('RecipeCard (native, grid) — W-08: the cuisine overline never sits under the time chip', () => {
    it('draws no overline on a cover that carries the time chip', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ cuisine: 'French', totalTimeMinutes: 15, coverPhotoUrl: undefined })}
            />,
        );

        layOutAll(container, 150);

        // The meta line says it; the cover must not say it again beneath the chip.
        expect(screen.getAllByText('French')).toHaveLength(1);
    });

    it('keeps the overline on a cover with no time chip', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ cuisine: 'French', totalTimeMinutes: 0, coverPhotoUrl: undefined })}
            />,
        );

        layOutAll(container, 150);

        expect(screen.getAllByText('French')).toHaveLength(2);
    });

    it('caps the status chip at half the cover, and keeps its word as its name', () => {
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ status: RecipeStatus.DRAFT })} />);
        const chip = screen.getByLabelText('Draft');

        expect(getComputedStyle(chip.parentElement as HTMLElement).maxWidth).toBe('50%');
    });
});
