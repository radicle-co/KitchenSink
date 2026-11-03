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
import { COVER_CHIP_INSET, COVER_CHIP_PADDING } from '../coverChip.js';

afterEach(cleanup);

const model = (over: Parameters<typeof makeRecipe>[0] = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);
const VARIANTS: readonly CardVariant[] = ['grid', 'row', 'compact'];

describe.each(VARIANTS)('RecipeCard (web, %s) — what every variant keeps', (variant) => {
    it('names the card by its title, and shows the title as a heading', () => {
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 3, name: 'Herb Risotto' })).toBeTruthy();
    });

    it.each([2, 3] as const)(
        'draws the title at the heading level it is told (%s), so the outline has no skipped level',
        (level) => {
            renderCard(<RecipeCard variant={variant} headingLevel={level} recipe={model({ title: 'Herb Risotto' })} />);

            expect(screen.getByRole('heading', { level, name: 'Herb Risotto' })).toBeTruthy();
            expect(screen.queryAllByRole('heading')).toHaveLength(1);
        },
    );

    it('keeps the cover photo out of the accessibility tree, so the title is said once', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ coverPhotoUrl: 'https://cdn/x.jpg', ratingCount: 0 })}
            />,
        );

        expect(container.querySelector('img[src="https://cdn/x.jpg"]')?.getAttribute('alt')).toBe('');
        expect(screen.queryAllByRole('img').filter((node) => node.tagName === 'IMG')).toHaveLength(0);
    });

    it('names the PRO badge for a premium recipe, and draws none otherwise', () => {
        const { unmount } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} recipe={model({ usesPremiumCapability: true })} />,
        );

        expect(screen.getByLabelText('Pro recipe')).toBeTruthy();
        unmount();

        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByLabelText('Pro recipe')).toBeNull();
    });

    it('is inert with no onSelect and no href: no link and no button', () => {
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('with an href, is ONE link named by the title, and hands a plain click to onSelect', () => {
        const onSelect = vi.fn();
        renderCard(
            <RecipeCard
                headingLevel={3}
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
                headingLevel={3}
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
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ id: 'rec_7', title: 'Pasta' })}
                onSelect={onSelect}
            />,
        );

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Pasta' }));

        expect(onSelect).toHaveBeenCalledWith('rec_7');
    });

    it('is a level-1 card in roles — paper, a divider hairline — and never glass (D12)', () => {
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ title: 'Herb Risotto' })} />);
        const card = screen.getByRole('article', { name: 'Herb Risotto' });

        expect(card.className).toContain('bg-paper');
        expect(card.className).toContain('border-line-divider');
        expect(card.className).not.toMatch(/glass|backdrop/u);
        expect(card.style.backdropFilter).toBe('');
        expect(card.getAttribute('data-card-variant')).toBe(variant);
    });
});

describe.each(VARIANTS)('RecipeCard (web, %s) — the fields no card shows (designAnswers.md, 2026-11-02)', (variant) => {
    const loaded = model({
        title: 'Herb Risotto',
        servings: 4,
        cuisine: 'Italian',
        tags: ['vegan', 'quick'],
        currentVersion: 9,
        totalTimeMinutes: 35,
        difficulty: RecipeDifficulty.MEDIUM,
        coverPhotoUrl: undefined,
    });

    it('draws no servings, cuisine, tags, version or cover time chip', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={loaded}
                showEdited
                nutrition={<span>520 cal</span>}
            />,
        );

        expect(screen.queryByText(/Serves/u)).toBeNull();
        expect(screen.queryByLabelText('Serves 4')).toBeNull();
        expect(screen.queryByText('Italian')).toBeNull();
        expect(screen.queryByText(/vegan/u)).toBeNull();
        expect(screen.queryByText(/v9/u)).toBeNull();
        expect(container.querySelector('[class*="bg-photo-chip"] .tabular-nums')).toBeNull();
    });

    it('draws no difficulty badge: no meter, and the word is plain text', () => {
        const { container } = renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={loaded} />);

        expect(container.querySelector('[data-meter-dot]')).toBeNull();
        const word = screen.queryByText('Medium');

        if (variant === 'compact') {
            // The compact tile's brief line (time, calories) carries no difficulty.
            expect(word).toBeNull();
        } else {
            expect(word?.className ?? '').not.toContain('truncate');
            expect(word?.parentElement?.className ?? '').not.toContain('border');
        }
    });
});

describe('RecipeCard (web) — the meta line reads time, difficulty, rating, calories', () => {
    it.each(['grid', 'row'] as const)('says them in that order on one line (%s)', (variant) => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({
                    totalTimeMinutes: 35,
                    difficulty: RecipeDifficulty.MEDIUM,
                    averageRating: 4.75,
                    ratingCount: 12,
                })}
                nutrition={<span>520 cal</span>}
            />,
        );
        const line = screen.getByLabelText('35 minutes total time').closest('[class*="h-lh"]') as HTMLElement;

        expect(line.textContent).toMatch(/35 min.*Medium.*4\.8 \(12\).*520 cal/u);
    });
});

describe('RecipeCard (web, grid) — the full CR-002 card', () => {
    it('lays out four rows (cover, title, meta line, last line), so the subgrid can align them across a grid row', () => {
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ title: 'Herb Risotto', tags: [] })} />);

        expect(screen.getByRole('article', { name: 'Herb Risotto' }).children).toHaveLength(4);
    });

    it('chips the cover with the status only, and says the total time in hours and minutes on the meta line', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ status: RecipeStatus.DRAFT, totalTimeMinutes: 330 })}
            />,
        );

        expect(screen.getByText('Draft')).toBeTruthy();
        const time = screen.getByLabelText('330 minutes total time');
        expect(time.textContent).toContain('5 h 30 min');
        expect(time.closest('[class*="bg-photo-chip"]')).toBeNull();
    });

    it('draws a published public recipe with no status chip on its cover', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC })}
            />,
        );

        expect(screen.queryByText('Draft')).toBeNull();
        expect(screen.queryByText('Private')).toBeNull();
    });

    it('says the stated difficulty as a word beside its meter, and draws nothing when none was stated', () => {
        const { unmount } = renderCard(
            <RecipeCard headingLevel={3} variant="grid" recipe={model({ difficulty: RecipeDifficulty.MEDIUM })} />,
        );

        expect(screen.getByText('Medium')).toBeTruthy();
        unmount();

        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ difficulty: undefined })} />);

        for (const word of ['Easy', 'Medium', 'Hard']) {
            expect(screen.queryByText(word)).toBeNull();
        }
    });

    it('names a rated recipe’s stars and shows the short figure', () => {
        renderCard(
            <RecipeCard headingLevel={3} variant="grid" recipe={model({ averageRating: 4.75, ratingCount: 12 })} />,
        );

        const stars = screen.getByRole('img', { name: 'Rated 4.8 out of 5, 12 ratings' });
        expect(stars.textContent).toContain('4.8 (12)');
    });

    it('says an unrated recipe has no ratings, and draws no stars', () => {
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('No ratings yet')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /Rated/u })).toBeNull();
    });

    it('renders the nutrition slot on the meta line', () => {
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model()} nutrition={<span>612 cal</span>} />);

        expect(screen.getByText('612 cal')).toBeTruthy();
    });

    it('renders no nutrition item at all when the slot is absent', () => {
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ cuisine: undefined })} />);

        expect(screen.queryByText(/cal/u)).toBeNull();
    });

    it('puts only the timestamp in the footer, with no version', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({
                    currentVersion: 12,
                    createdAt: '2020-01-01T00:00:00.000Z',
                    updatedAt: '2020-01-02T00:00:00.000Z',
                })}
            />,
        );

        expect(screen.getByText(/^Edited /u)).toBeTruthy();
    });
});

describe('RecipeCard (web, row) — the list row', () => {
    it('names the time on its meta line', () => {
        renderCard(<RecipeCard headingLevel={3} variant="row" recipe={model({ totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByLabelText('45 minutes total time').textContent).toContain('45 min');
    });

    it('orders the title, then the meta line (with the difficulty word), then the status line', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ title: 'Herb Risotto', totalTimeMinutes: 35, difficulty: RecipeDifficulty.MEDIUM })}
            />,
        );
        const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const title = screen.getByRole('heading', { name: 'Herb Risotto' });
        const meta = screen.getByLabelText('35 minutes total time').parentElement as HTMLElement;
        const status = screen.getByText(/^Created |^Edited /u);

        expect(meta.textContent).toContain('Medium');
        expect(before(title, meta)).toBe(true);
        expect(before(meta, status)).toBe(true);
    });

    it.each<[RecipeVisibility, string]>([
        [RecipeVisibility.PRIVATE, 'Private'],
        [RecipeVisibility.PUBLIC, 'Public'],
    ])('draws a published %s recipe’s visibility as a named glyph only', (visibility, name) => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ status: RecipeStatus.PUBLISHED, visibility })}
            />,
        );

        expect(screen.getByRole('img', { name })).toBeTruthy();
        expect(screen.queryByText(name)).toBeNull();
    });

    it('draws a draft as the Draft badge, never its visibility', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PUBLIC })}
            />,
        );

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByRole('img', { name: 'Public' })).toBeNull();
    });

    it('drops the tags and the version — the only variant that drops fields', () => {
        renderCard(
            <RecipeCard headingLevel={3} variant="row" recipe={model({ tags: ['vegan'], currentVersion: 9 })} />,
        );

        expect(screen.queryByText('vegan')).toBeNull();
        expect(screen.queryByText(/v9/u)).toBeNull();
    });
});

describe('RecipeCard (web, compact) — Home below 960', () => {
    it('has no rating, cuisine or version: its meta line is the time, then the calories', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                recipe={model({ averageRating: 4, ratingCount: 3, cuisine: 'Thai', currentVersion: 4 })}
            />,
        );

        expect(screen.queryByRole('img', { name: /Rated/u })).toBeNull();
        expect(screen.queryByText('Thai')).toBeNull();
        expect(screen.queryByText(/^v4/u)).toBeNull();
    });

    it('keeps the draft status chip on its cover (homeCardsA §4)', () => {
        renderCard(<RecipeCard headingLevel={3} variant="compact" recipe={model({ status: RecipeStatus.DRAFT })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
    });
});

describe('RecipeCard (web) — a custom arrangement', () => {
    it('renders the parts a surface arranges, inside the card', () => {
        renderCard(
            <RecipeCard headingLevel={3} recipe={model({ title: 'Soup', ratingCount: 0 })}>
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
                    headingLevel={3}
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
                headingLevel={3}
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
                headingLevel={3}
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
                headingLevel={3}
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
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="grid" recipe={model({ title: 'Herb Risotto' })} />,
        );

        expect(container.querySelector('[data-card-footer]')).toBeNull();
    });
});

const itemClasses = (label: string): readonly string[] => screen.getByLabelText(label).className.split(/\s+/u);

describe('RecipeCard (web) — W-06: a one-line row is one line, and a separator only follows a visible item', () => {
    it('sizes the meta line to exactly one line of its own type role, so a dropped item leaves no sliver', () => {
        renderCard(<RecipeCard headingLevel={3} variant="row" recipe={model({ totalTimeMinutes: 35 })} />);
        const line = screen
            .getByLabelText('35 minutes total time')
            .closest('[class*="overflow-hidden"]') as HTMLElement;

        expect(line.className.split(/\s+/u)).toEqual(expect.arrayContaining(['h-lh', 'text-meta']));
        expect(line.className.split(/\s+/u)).not.toContain('h-6');
    });

    it('draws the separator after a visible sibling, never `not-first` (an absent time left it as a line-leading dot)', () => {
        renderCard(<RecipeCard headingLevel={3} variant="grid" recipe={model({ totalTimeMinutes: 35 })} />);
        const classes = itemClasses('35 minutes total time');

        expect(classes).toContain('[:not(:empty)~&]:before:content-[attr(data-sep)]');
        expect(classes.filter((token) => token.startsWith('not-first:'))).toEqual([]);
    });
});

describe('RecipeCard (web, grid) — cover chips', () => {
    // REWRITTEN for the designer's ruling (2026-11-03, designAnswers.md bdb2403cb), which reverses W-08's half-cover cap:
    // the chip takes its content width, its word never truncates, a second chip moves whole to the next line, and a chip
    // wider than the cover drops its glyph and keeps the word.
    describe('the status chip takes its content width and never clips its word (designer ruling 2026-11-03)', () => {
        const draftAndPro = () =>
            renderCard(
                <RecipeCard
                    headingLevel={3}
                    variant="grid"
                    recipe={model({ status: RecipeStatus.DRAFT, usesPremiumCapability: true })}
                />,
            );
        const classesOf = (node: HTMLElement) => node.className.split(/\s+/u);

        it('has no half-cover cap: the chip may be as wide as the row it sits in', () => {
            draftAndPro();
            const chip = screen.getByText('Draft').parentElement as HTMLElement;

            expect(classesOf(chip)).toContain('max-w-full');
            expect(classesOf(chip)).not.toContain('max-w-1/2');
        });

        it('does not truncate the word', () => {
            draftAndPro();

            expect(classesOf(screen.getByText('Draft'))).not.toContain('truncate');
        });

        it('lays the word before the glyph in a reversed, wrapping, clipped line, so a chip too wide drops the glyph and keeps the word', () => {
            draftAndPro();
            const chip = screen.getByText('Draft').parentElement as HTMLElement;

            expect(classesOf(chip)).toEqual(
                expect.arrayContaining(['flex-row-reverse', 'flex-wrap', 'overflow-hidden']),
            );
            expect(chip.firstElementChild).toBe(screen.getByText('Draft'));
        });

        it('reads its insets and padding from coverChip.ts, not from classes that repeat the numbers', () => {
            draftAndPro();
            const chip = screen.getByText('Draft').parentElement as HTMLElement;
            const row = chip.parentElement as HTMLElement;

            expect(row.style.top).toBe(`${String(COVER_CHIP_INSET)}px`);
            expect(row.style.left).toBe(`${String(COVER_CHIP_INSET)}px`);
            expect(row.style.right).toBe(`${String(COVER_CHIP_INSET)}px`);
            expect(chip.style.paddingLeft).toBe(`${String(COVER_CHIP_PADDING)}px`);
            expect(chip.style.paddingRight).toBe(`${String(COVER_CHIP_PADDING)}px`);
            expect(classesOf(row)).not.toEqual(expect.arrayContaining(['inset-x-2']));
            expect(classesOf(chip)).not.toContain('px-2');
        });

        it('keeps the status chip and PRO in one wrapping row, so the second moves whole to the next line', () => {
            draftAndPro();
            const row = (screen.getByText('Draft').parentElement as HTMLElement).parentElement as HTMLElement;

            expect(classesOf(row)).toContain('flex-wrap');
            expect(row.contains(screen.getByLabelText('Pro recipe'))).toBe(true);
        });
    });
});

// Designer ruling (2026-11-02): the Recipes phone grid is the compact tile in size, but it KEEPS the "Edited" footer line,
// because a Recipes sort may not be by recency. Only Home drops it. So the compact tile carries the line when it is asked
// for (`showEdited`), and Home, which does not ask, stays the cover and the title.
describe("RecipeCard (web, compact) — the Edited line is the surface's choice", () => {
    const edited = {
        currentVersion: 1,
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-02T00:00:00.000Z',
    } as const;

    it('shows "Edited …" under the title when the surface asks for it (a Recipes tile)', () => {
        renderCard(<RecipeCard headingLevel={3} variant="compact" showEdited recipe={model(edited)} />);

        expect(screen.getByText(/^Edited /u)).toBeTruthy();
    });

    it('shows no Edited line when it does not (a Home tile)', () => {
        renderCard(<RecipeCard headingLevel={3} variant="compact" recipe={model(edited)} />);

        expect(screen.queryByText(/Edited/u)).toBeNull();
    });

    it('says "Created …" for a recipe never edited, and still on one line', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                showEdited
                recipe={model({ createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' })}
            />,
        );

        expect(screen.getByText(/^Created /u)).toBeTruthy();
    });

    it('lets a surface footer replace it, as in the grid (a card has one last line)', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                showEdited
                recipe={model(edited)}
                footer={<span>@braise.club</span>}
            />,
        );

        expect(screen.queryByText(/Edited/u)).toBeNull();
        expect(screen.getByText('@braise.club')).toBeTruthy();
    });
});

// Designer ruling (2026-11-03, designAnswers.md): every tile has a meta line. A compact Home tile shows the time, then the
// calories; the Recipes grid tile (also the compact variant, asked with `fullMeta`) shows the list row's whole line. A
// part with no data is left out, and a line with no parts is left out.
describe('RecipeCard (web, compact) — the meta line', () => {
    const rated = { totalTimeMinutes: 35, difficulty: RecipeDifficulty.MEDIUM, averageRating: 4.75, ratingCount: 12 };

    it('shows the time, then the calories, and nothing else, on a Home tile', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="compact" recipe={model(rated)} nutrition={<span>520 cal</span>} />,
        );
        const line = container.querySelector('[class*="h-lh"]') as HTMLElement;

        expect(line.textContent?.replace(/\s+/gu, ' ')).toMatch(/^\s*35 min\s*520 cal\s*$/u);
        expect(screen.queryByText('Medium')).toBeNull();
        expect(screen.queryByText(/4\.8/u)).toBeNull();
    });

    it('leaves out the time when the recipe has none, and keeps the calories', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                recipe={model({ ...rated, totalTimeMinutes: 0 })}
                nutrition={<span>520 cal</span>}
            />,
        );

        expect(screen.queryByLabelText(/total time/u)).toBeNull();
        expect(container.querySelector('[class*="h-lh"]')?.textContent).toContain('520 cal');
    });

    it('leaves out the calories when there is no figure, and keeps the time', () => {
        const { container } = renderCard(<RecipeCard headingLevel={3} variant="compact" recipe={model(rated)} />);

        expect(container.querySelector('[class*="h-lh"]')?.textContent).toBe('35 min');
    });

    it('draws no line at all when neither the time nor the calories exist', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="compact" recipe={model({ ...rated, totalTimeMinutes: 0 })} />,
        );

        expect(container.querySelector('[class*="h-lh"]')).toBeNull();
    });

    it('draws the whole list-row line on a Recipes tile that asks for it (fullMeta)', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                fullMeta
                recipe={model(rated)}
                nutrition={<span>520 cal</span>}
            />,
        );
        const line = container.querySelector('[class*="h-lh"]') as HTMLElement;

        expect(line.textContent).toMatch(/35 min.*Medium.*4\.8 \(12\).*520 cal/u);
    });

    it('drops only the absent parts of the whole line (no difficulty, no calories)', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                fullMeta
                recipe={model({ ...rated, difficulty: undefined })}
            />,
        );
        const text = container.querySelector('[class*="h-lh"]')?.textContent ?? '';

        expect(text).toMatch(/35 min.*4\.8 \(12\)/u);
        expect(text).not.toContain('Medium');
        expect(text).not.toContain('cal');
    });
});

// Designer ruling (2026-11-03): the status chips sit over the cover and never push the cover letter down.
describe.each(['grid', 'compact'] as const)(
    'RecipeCard (web, %s) — the chips are an overlay on the cover',
    (variant) => {
        it('lays the Draft chip over the cover, out of its flow', () => {
            renderCard(
                <RecipeCard
                    headingLevel={3}
                    variant={variant}
                    recipe={model({ title: 'Herb Risotto', status: RecipeStatus.DRAFT, coverPhotoUrl: undefined })}
                />,
            );
            const cover = screen.getByText('H').closest('[aria-hidden="true"]')?.parentElement as HTMLElement;
            const chip = screen.getByText('Draft');
            const overlay = chip.closest('.absolute') as HTMLElement;

            expect(cover.children).toHaveLength(1);
            expect(cover.contains(chip)).toBe(false);
            expect(overlay.parentElement).toBe(cover.parentElement);
        });
    },
);
