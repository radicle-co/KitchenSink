// @vitest-environment jsdom
/**
 * The web recipe card's three variants (`docs/design/uiOverhaul/buildSpec.md` §4.1) and the invariants every variant
 * keeps: the card is ONE control named by its title, the cover is decoration, an absent difficulty or rating is never
 * fabricated, the surface is a level-1 card and never glass (owner ruling D12), and colour comes from roles (D15).
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul. The card used to be one arrangement in a frosted-glass shell, wrapped in
 * `PressScale`, with tag chips and a coloured difficulty pill. D12 takes glass off cards, §4.1 splits the card into
 * grid / row / compact, and the card's control is now a stretched link (or button) inside the title, so nothing is
 * nested in it. The old glass assertions are deleted with the glass; the absent-state and naming assertions are kept.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { CardVariant } from '../cardVariant.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCard } from '../RecipeCard.js';

afterEach(cleanup);

const model = (over: Parameters<typeof makeRecipe>[0] = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);
const VARIANTS: readonly CardVariant[] = ['grid', 'row', 'compact'];

describe.each(VARIANTS)('RecipeCard (web, %s) — what every variant keeps', (variant) => {
    it('names the card by its title, and shows the title as a heading', () => {
        renderCard(<RecipeCard variant={variant} recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 3, name: 'Herb Risotto' })).toBeTruthy();
    });

    it('keeps the cover photo out of the accessibility tree, so the title is said once', () => {
        const { container } = renderCard(
            <RecipeCard variant={variant} recipe={model({ coverPhotoUrl: 'https://cdn/x.jpg', ratingCount: 0 })} />,
        );

        expect(container.querySelector('img[src="https://cdn/x.jpg"]')?.getAttribute('alt')).toBe('');
        expect(screen.queryAllByRole('img').filter((node) => node.tagName === 'IMG')).toHaveLength(0);
    });

    it('names the PRO badge for a premium recipe, and draws none otherwise', () => {
        const { unmount } = renderCard(
            <RecipeCard variant={variant} recipe={model({ usesPremiumCapability: true })} />,
        );

        expect(screen.getByLabelText('Premium recipe')).toBeTruthy();
        unmount();

        renderCard(<RecipeCard variant={variant} recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByLabelText('Premium recipe')).toBeNull();
    });

    it('is inert with no onSelect and no href: no link and no button', () => {
        renderCard(<RecipeCard variant={variant} recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('with an href, is ONE link named by the title, and hands a plain click to onSelect', () => {
        const onSelect = vi.fn();
        renderCard(
            <RecipeCard
                variant={variant}
                recipe={model({ id: 'rec_42', title: 'Herb Risotto' })}
                href="/en/recipes/rec_42"
                onSelect={onSelect}
            />,
        );

        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveProperty('textContent', 'Herb Risotto');
        expect(links[0]?.getAttribute('href')).toBe('/en/recipes/rec_42');

        const plain = fireEvent.click(links[0]!, { button: 0 });

        expect(plain, 'a plain click is taken over').toBe(false);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });

    it('leaves a modified click to the browser (open in a new tab)', () => {
        const onSelect = vi.fn();
        renderCard(
            <RecipeCard
                variant={variant}
                recipe={model({ id: 'rec_42' })}
                href="/en/recipes/rec_42"
                onSelect={onSelect}
            />,
        );

        const followed = fireEvent.click(screen.getByRole('link'), { button: 0, metaKey: true });

        expect(followed, 'the browser keeps the click').toBe(true);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('with onSelect and no href, is ONE button named by the title', () => {
        const onSelect = vi.fn();
        renderCard(
            <RecipeCard variant={variant} recipe={model({ id: 'rec_7', title: 'Pasta' })} onSelect={onSelect} />,
        );

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Pasta' }));

        expect(onSelect).toHaveBeenCalledWith('rec_7');
    });

    it('is a level-1 card in roles — paper, a divider hairline — and never glass (D12)', () => {
        renderCard(<RecipeCard variant={variant} recipe={model({ title: 'Herb Risotto' })} />);
        const card = screen.getByRole('article', { name: 'Herb Risotto' });

        expect(card.className).toContain('bg-paper');
        expect(card.className).toContain('border-line-divider');
        expect(card.className).not.toMatch(/glass|backdrop/u);
        expect(card.style.backdropFilter).toBe('');
        expect(card.getAttribute('data-card-variant')).toBe(variant);
    });
});

describe('RecipeCard (web, grid) — the full CR-002 card', () => {
    it('lays out six rows, so the subgrid can align them across a grid row (an empty row keeps its track)', () => {
        renderCard(<RecipeCard variant="grid" recipe={model({ title: 'Herb Risotto', tags: [] })} />);

        expect(screen.getByRole('article', { name: 'Herb Risotto' }).children).toHaveLength(6);
    });

    it('chips the cover with the status, and the total time in hours and minutes', () => {
        renderCard(<RecipeCard variant="grid" recipe={model({ status: RecipeStatus.DRAFT, totalTimeMinutes: 330 })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.getByLabelText('330 minutes total time').textContent).toContain('5 h 30 min');
    });

    it('draws a published public recipe with no status chip on its cover', () => {
        renderCard(
            <RecipeCard
                variant="grid"
                recipe={model({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC })}
            />,
        );

        expect(screen.queryByText('Draft')).toBeNull();
        expect(screen.queryByText('Private')).toBeNull();
    });

    it('says the stated difficulty as a word beside its meter, and draws nothing when none was stated', () => {
        const { unmount } = renderCard(
            <RecipeCard variant="grid" recipe={model({ difficulty: RecipeDifficulty.MEDIUM })} />,
        );

        expect(screen.getByText('Medium')).toBeTruthy();
        unmount();

        renderCard(<RecipeCard variant="grid" recipe={model({ difficulty: undefined })} />);

        for (const word of ['Easy', 'Medium', 'Hard']) {
            expect(screen.queryByText(word)).toBeNull();
        }
    });

    it('names a rated recipe’s stars and shows the short figure', () => {
        renderCard(<RecipeCard variant="grid" recipe={model({ averageRating: 4.75, ratingCount: 12 })} />);

        const stars = screen.getByRole('img', { name: 'Rated 4.8 out of 5, 12 ratings' });
        expect(stars.textContent).toContain('4.8 (12)');
    });

    it('says an unrated recipe has no ratings, and draws no stars', () => {
        renderCard(<RecipeCard variant="grid" recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('No ratings yet')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /Rated/u })).toBeNull();
    });

    it('renders the cuisine, the nutrition slot and the servings on the meta line', () => {
        renderCard(
            <RecipeCard
                variant="grid"
                recipe={model({ cuisine: 'Moroccan', servings: 8 })}
                nutrition={<span>612 cal</span>}
            />,
        );

        expect(screen.getByText('Moroccan')).toBeTruthy();
        expect(screen.getByText('612 cal')).toBeTruthy();
        expect(screen.getByLabelText('Serves 8').textContent).toBe('Serves 8');
    });

    it('renders no nutrition item at all when the slot is absent', () => {
        renderCard(<RecipeCard variant="grid" recipe={model({ cuisine: undefined })} />);

        expect(screen.queryByText(/cal/u)).toBeNull();
    });

    it('says the tags as one line of text with the rest counted, and names the full list', () => {
        renderCard(
            <RecipeCard variant="grid" recipe={model({ tags: ['gluten-free', 'slow-cooked', 'braise', 'lamb'] })} />,
        );

        const line = screen.getByText('gluten-free · slow-cooked · +2');
        expect(line.getAttribute('title')).toBe('gluten-free, slow-cooked, braise, lamb');
        expect(screen.queryByRole('listitem')).toBeNull();
    });

    it('joins the version and the timestamp in the footer', () => {
        renderCard(
            <RecipeCard
                variant="grid"
                recipe={model({
                    currentVersion: 12,
                    createdAt: '2020-01-01T00:00:00.000Z',
                    updatedAt: '2020-01-02T00:00:00.000Z',
                })}
            />,
        );

        expect(screen.getByText(/^v12 · Edited /u)).toBeTruthy();
    });
});

describe('RecipeCard (web, row) — the list row', () => {
    it('names the time and the servings on its meta line', () => {
        renderCard(<RecipeCard variant="row" recipe={model({ totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByLabelText('45 minutes total time').textContent).toContain('45 min');
        expect(screen.getByLabelText('Serves 4').textContent).toContain('4');
    });

    it.each<[RecipeVisibility, string]>([
        [RecipeVisibility.PRIVATE, 'Private'],
        [RecipeVisibility.PUBLIC, 'Public'],
    ])('draws a published %s recipe’s visibility as a named glyph only', (visibility, name) => {
        renderCard(<RecipeCard variant="row" recipe={model({ status: RecipeStatus.PUBLISHED, visibility })} />);

        expect(screen.getByRole('img', { name })).toBeTruthy();
        expect(screen.queryByText(name)).toBeNull();
    });

    it('draws a draft as the Draft badge, never its visibility', () => {
        renderCard(
            <RecipeCard
                variant="row"
                recipe={model({ status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PUBLIC })}
            />,
        );

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByRole('img', { name: 'Public' })).toBeNull();
    });

    it('drops the tags and the version — the only variant that drops fields', () => {
        renderCard(<RecipeCard variant="row" recipe={model({ tags: ['vegan'], currentVersion: 9 })} />);

        expect(screen.queryByText('vegan')).toBeNull();
        expect(screen.queryByText(/v9/u)).toBeNull();
    });
});

describe('RecipeCard (web, compact) — Home below 960', () => {
    it('is the cover and the title only: no rating, no meta line, no footer', () => {
        renderCard(
            <RecipeCard
                variant="compact"
                recipe={model({ averageRating: 4, ratingCount: 3, cuisine: 'Thai', currentVersion: 4 })}
            />,
        );

        expect(screen.queryByRole('img', { name: /Rated/u })).toBeNull();
        expect(screen.queryByText('Thai')).toBeNull();
        expect(screen.queryByText(/^v4/u)).toBeNull();
    });

    it('keeps the draft status chip on its cover (homeCardsA §4)', () => {
        renderCard(<RecipeCard variant="compact" recipe={model({ status: RecipeStatus.DRAFT })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
    });
});

describe('RecipeCard (web) — a custom arrangement', () => {
    it('renders the parts a surface arranges, inside the card', () => {
        renderCard(
            <RecipeCard recipe={model({ title: 'Soup', ratingCount: 0 })}>
                <RecipeCard.Title />
                <RecipeCard.Rating />
            </RecipeCard>,
        );
        const card = screen.getByRole('article', { name: 'Soup' });

        expect(within(card).getByText('No ratings yet')).toBeTruthy();
        expect(card.getAttribute('data-card-variant')).toBe('custom');
    });

    it('refuses a part rendered outside a card', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderCard(<RecipeCard.Title />)).toThrow(/inside a <RecipeCard>/u);
    });
});

describe('RecipeCard (web) — slots for a surface’s own controls', () => {
    const footerButton = (onPress: () => void) => (
        <button type="button" onClick={onPress}>
            Save a copy of Herb Risotto
        </button>
    );

    it.each(['grid', 'compact'] as const)(
        'draws a %s footer inside the card, with its control OUTSIDE the card’s link',
        (variant) => {
            const onSelect = vi.fn();
            const onCopy = vi.fn();
            renderCard(
                <RecipeCard
                    variant={variant}
                    recipe={model({ id: 'rec_1', title: 'Herb Risotto' })}
                    href="/en/recipes/rec_1"
                    onSelect={onSelect}
                    footer={footerButton(onCopy)}
                />,
            );
            const card = screen.getByRole('article', { name: 'Herb Risotto' });
            const control = within(card).getByRole('button', { name: 'Save a copy of Herb Risotto' });
            const link = within(card).getByRole('link', { name: 'Herb Risotto' });

            expect(link.contains(control)).toBe(false);

            fireEvent.click(control);

            expect(onCopy).toHaveBeenCalledOnce();
            expect(onSelect).not.toHaveBeenCalled();
        },
    );

    it('lifts the footer’s control above the link’s stretched hit area, so a press reaches it', () => {
        renderCard(
            <RecipeCard
                variant="compact"
                recipe={model({ title: 'Herb Risotto' })}
                href="/en/recipes/x"
                footer={footerButton(vi.fn())}
            />,
        );
        const control = screen.getByRole('button', { name: 'Save a copy of Herb Risotto' });

        expect(control.closest('[data-card-footer]')?.className).toContain('relative');
        expect(control.closest('[data-card-footer]')?.className).toContain('z-10');
    });

    it('replaces the own-recipe footer (version and timestamp) in the grid card’s sixth row', () => {
        renderCard(
            <RecipeCard
                variant="grid"
                recipe={model({ title: 'Herb Risotto', currentVersion: 12 })}
                footer={<span>@braise.club</span>}
            />,
        );
        const card = screen.getByRole('article', { name: 'Herb Risotto' });

        expect(within(card).getByText('@braise.club')).toBeTruthy();
        expect(within(card).queryByText(/v12/u)).toBeNull();
    });

    it('draws a row’s note inside the link’s text and its trailing control outside the link', () => {
        const onMenu = vi.fn();
        renderCard(
            <RecipeCard
                variant="row"
                recipe={model({ title: 'Herb Risotto' })}
                href="/en/recipes/x"
                note={<span>Added by you</span>}
                trailing={
                    <button type="button" onClick={onMenu}>
                        More actions for Herb Risotto
                    </button>
                }
            />,
        );
        const card = screen.getByRole('article', { name: 'Herb Risotto' });
        const menu = within(card).getByRole('button', { name: 'More actions for Herb Risotto' });

        expect(within(card).getByText('Added by you')).toBeTruthy();
        expect(within(card).getByRole('link').contains(menu)).toBe(false);

        fireEvent.click(menu);

        expect(onMenu).toHaveBeenCalledOnce();
    });

    it('draws nothing extra when no slot is given', () => {
        const { container } = renderCard(<RecipeCard variant="grid" recipe={model({ title: 'Herb Risotto' })} />);

        expect(container.querySelector('[data-card-footer]')).toBeNull();
    });
});
