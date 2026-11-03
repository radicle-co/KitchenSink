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
import { cleanup, screen, within } from '@testing-library/react';
import { pressFrameOf, render } from '@commise/ui/testing/tamagui';
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

        expect(screen.getByLabelText('Pro recipe')).toBeTruthy();
        unmount();
        renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByLabelText('Pro recipe')).toBeNull();
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
    it('chips the cover with Draft only, and says the time in hours and minutes on the meta line', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({ status: RecipeStatus.DRAFT, totalTimeMinutes: 330 })}
            />,
        );

        expect(screen.getByText('Draft')).toBeTruthy();
        const time = screen.getByLabelText('330 minutes total time');
        expect(time).toBeTruthy();
        expect(screen.getByText('5 h 30 min')).toBeTruthy();
        expect(getComputedStyle(time).backgroundColor).not.toBe(rgb(role.photoChip));
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

    it('renders the nutrition slot and a footer of the timestamp alone', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="grid"
                recipe={model({
                    currentVersion: 3,
                    createdAt: '2020-01-01T00:00:00.000Z',
                    updatedAt: '2020-01-02T00:00:00.000Z',
                })}
                nutrition={<span>612 cal</span>}
            />,
        );

        expect(screen.getByText('612 cal')).toBeTruthy();
        expect(screen.getByText(/^Edited /u)).toBeTruthy();
    });
});

describe.each(VARIANTS)(
    'RecipeCard (native, %s) — the fields no card shows (designAnswers.md, 2026-11-02)',
    (variant) => {
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

        it('draws no servings, cuisine, tags or version', () => {
            renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={loaded} showEdited />);

            expect(screen.queryByText(/Serves/u)).toBeNull();
            expect(screen.queryByLabelText(/Serves/u)).toBeNull();
            expect(screen.queryByText('Italian')).toBeNull();
            expect(screen.queryByText(/vegan/u)).toBeNull();
            expect(screen.queryByText(/v9/u)).toBeNull();
        });

        it('draws no cover time chip, and no difficulty badge: the word is plain text with no meter beside it', () => {
            const { container } = renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={loaded} />);

            if (variant === 'compact') {
                // The brief line (time, calories) has no difficulty; its time sits in the line, not on the cover.
                expect(screen.queryByText('Medium')).toBeNull();
            } else {
                const word = screen.getByText('Medium');
                // A badge is a view holding a hidden three-dot meter beside the word.
                const meters = [...(word.parentElement?.querySelectorAll('[aria-hidden="true"]') ?? [])].filter(
                    (node) => node.children.length === 3,
                );

                expect(meters).toHaveLength(0);
            }

            expect(container.querySelector('[class*="cover"] [aria-label="35 minutes total time"]')).toBeNull();
        });
    },
);

describe.each(['grid', 'row'] as const)('RecipeCard (native, %s) — the meta line', (variant) => {
    it('reads time, difficulty, rating, calories on one line', () => {
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
        const line = screen.getByLabelText('35 minutes total time').parentElement as HTMLElement;

        expect(line.textContent).toMatch(/35 min.*Medium.*4\.8 \(12\).*520 cal/u);
    });
});

describe('RecipeCard (native, row)', () => {
    it('orders the title, then the meta line, then the status line', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ title: 'Herb Risotto', totalTimeMinutes: 35, difficulty: RecipeDifficulty.MEDIUM })}
            />,
        );
        const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const meta = screen.getByLabelText('35 minutes total time');

        expect(before(screen.getByText('Herb Risotto'), meta)).toBe(true);
        expect(before(meta, screen.getByText(/^Created |^Edited /u))).toBe(true);
    });

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
    it('has no rating or cuisine on a Home tile', () => {
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

describe('RecipeCard (native, row) — A-016: the member row keeps its text beside a trailing control', () => {
    it('gives the link the row’s free width, so the title and meta are not squeezed to nothing', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="row"
                recipe={model({ title: 'Herb Risotto' })}
                onSelect={vi.fn()}
                note={<span>Added by you</span>}
                trailing={<button type="button">More actions for Herb Risotto</button>}
            />,
        );
        const link = screen.getByRole('link', { name: 'Herb Risotto' });
        // The box around the link's press-scale frame.
        const box = pressFrameOf(link).parentElement as HTMLElement;

        expect(link.contains(screen.getByText('Herb Risotto'))).toBe(true);
        expect(link.contains(screen.getByText('Added by you'))).toBe(true);
        // `PressScale fill` is `alignSelf: stretch`, which in a ROW stretches height, not width: the box must carry the
        // free width, with `minWidth: 0` so a long title wraps instead of widening the row.
        expect(getComputedStyle(box).flexGrow).toBe('1');
        expect(getComputedStyle(box).minWidth).toBe('0px');
    });
});

// REWRITTEN (designer ruling 2026-11-03, Android QA on 7ae95db2e): the meta line was W-06 / A-028's "exactly one line" row, a fixed
// height that hid whatever wrapped (rating and calories vanished on the Recipes grid). It now wraps and has no height at all,
// at any font scale; the coverage is "the meta line never hides a part" at the end of this file. The badge line keeps its
// fixed height.

describe('RecipeCard (native, grid) — cover chips', () => {
    // REWRITTEN for the designer's ruling (2026-11-03, designAnswers.md bdb2403cb), which reverses W-08's half-cover cap:
    // 50% of a 148 pt tile less the chip's padding and glyph left 38 pt, and "Private" needs 47. The chip takes its content
    // width, its word never truncates, a second chip moves whole to the next line, and a chip wider than the cover
    // drops its glyph and keeps the word. Pixel widths are the fit harness's (`libraryGrid.fit.test.ts`).
    describe('the status chip takes its content width and never clips its word (designer ruling 2026-11-03)', () => {
        const draftAndPro = () =>
            renderCard(
                <RecipeCard
                    headingLevel={3}
                    variant="grid"
                    recipe={model({ status: RecipeStatus.DRAFT, usesPremiumCapability: true })}
                />,
            );
        const wordOf = () => screen.getByText('Draft');
        const lineOf = () => wordOf().parentElement as HTMLElement;
        const chipOf = () => screen.getByLabelText('Draft');

        it('has no half-cover cap: the chip may be as wide as the row it sits in', () => {
            draftAndPro();

            expect(getComputedStyle(chipOf()).maxWidth).toBe('100%');
        });

        it('does not truncate the word', () => {
            draftAndPro();

            expect(getComputedStyle(wordOf()).textOverflow).not.toBe('ellipsis');
        });

        it('lays the word before the glyph in a reversed, wrapping, clipped line, so a chip too wide drops the glyph and keeps the word', () => {
            draftAndPro();
            const line = lineOf();
            const style = getComputedStyle(line);

            expect(style.flexDirection).toBe('row-reverse');
            expect(style.flexWrap).toBe('wrap');
            expect(style.overflowX).toBe('hidden');
            expect(line.firstElementChild).toBe(wordOf());
        });

        it('keeps the status chip and PRO in one wrapping row, so the second moves whole to the next line', () => {
            draftAndPro();
            const row = chipOf().parentElement as HTMLElement;

            expect(getComputedStyle(row).flexWrap).toBe('wrap');
            expect(row.contains(screen.getByLabelText('Pro recipe'))).toBe(true);
        });
    });
});

// Designer ruling (2026-11-02): the Recipes phone grid is the compact tile in size, but it KEEPS the "Edited" footer line,
// because a Recipes sort may not be by recency. Only Home drops it. So the compact tile carries the line when it is asked
// for (`showEdited`), and Home, which does not ask, stays the cover and the title.
describe("RecipeCard (native, compact) — the Edited line is the surface's choice", () => {
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
describe('RecipeCard (native, compact) — the meta line', () => {
    const rated = { totalTimeMinutes: 35, difficulty: RecipeDifficulty.MEDIUM, averageRating: 4.75, ratingCount: 12 };

    it('shows the time, then the calories, and nothing else, on a Home tile', () => {
        renderCard(
            <RecipeCard headingLevel={3} variant="compact" recipe={model(rated)} nutrition={<span>520 cal</span>} />,
        );
        const time = screen.getByLabelText('35 minutes total time');
        const calories = screen.getByText('520 cal');

        expect(time.compareDocumentPosition(calories) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText('Medium')).toBeNull();
        expect(screen.queryByText(/4\.8/u)).toBeNull();
        expect(screen.queryByText(/No ratings/u)).toBeNull();
    });

    it('leaves out the time when the recipe has none, and keeps the calories', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                recipe={model({ ...rated, totalTimeMinutes: 0 })}
                nutrition={<span>520 cal</span>}
            />,
        );

        expect(screen.queryByLabelText(/total time/u)).toBeNull();
        expect(screen.getByText('520 cal')).toBeTruthy();
    });

    it('leaves out the calories when there is no figure, and keeps the time', () => {
        renderCard(<RecipeCard headingLevel={3} variant="compact" recipe={model(rated)} />);

        expect(screen.getByLabelText('35 minutes total time')).toBeTruthy();
        expect(screen.queryByText(/cal/u)).toBeNull();
    });

    it('draws no line at all when neither the time nor the calories exist', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                recipe={model({ ...rated, title: 'Herb Risotto', totalTimeMinutes: 0 })}
            />,
        );

        // The body holds the title and nothing after it: no empty meta row to take a line's height.
        expect(screen.getByText('Herb Risotto').parentElement?.children).toHaveLength(1);
    });

    it('draws the whole list-row line on a Recipes tile that asks for it (fullMeta)', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                fullMeta
                recipe={model(rated)}
                nutrition={<span>520 cal</span>}
            />,
        );

        for (const part of [
            screen.getByLabelText('35 minutes total time'),
            screen.getByText('Medium'),
            screen.getByText('4.8 (12)'),
            screen.getByText('520 cal'),
        ]) {
            expect(part).toBeTruthy();
        }
    });
});

// Designer ruling (2026-11-03): the status chips sit over the cover. They are out of the cover's flow, so they can never
// push the cover letter down (qa-ios: 14 pt low at the largest text size).
describe.each(['grid', 'compact'] as const)(
    'RecipeCard (native, %s) — the chips are an overlay on the cover',
    (variant) => {
        it.each([1, 2])('lays the Draft chip over the cover, out of its flow, at font scale %s', (scale) => {
            fontScale.current = scale;
            renderCard(
                <RecipeCard
                    headingLevel={3}
                    variant={variant}
                    recipe={model({ title: 'Herb Risotto', status: RecipeStatus.DRAFT, coverPhotoUrl: undefined })}
                />,
            );
            const letter = screen.getByText('H');
            const region = letter.closest<HTMLElement>('[aria-hidden="true"]');
            const cover = region?.parentElement as HTMLElement;
            const chip = screen.getByText('Draft');
            let overlay: HTMLElement | null = chip;

            while (overlay !== null && window.getComputedStyle(overlay).position !== 'absolute') {
                overlay = overlay.parentElement;
            }

            expect(cover.children).toHaveLength(1);
            expect(cover.contains(chip)).toBe(false);
            expect(overlay).not.toBeNull();
            expect(overlay?.parentElement).toBe(cover.parentElement);
        });
    },
);

// Owner ruling (coordinator, 2026-11-03, Android QA on 7ae95db2e): no part with data is ever hidden. The meta line WRAPS
// onto more lines; it has no fixed height, no clip and no truncation (this reverses "items drop from the end").
describe.each(['grid', 'row', 'compact'] as const)(
    'RecipeCard (native, %s) — the meta line never hides a part',
    (variant) => {
        it.each([1, 2])(
            'wraps, has no fixed height or clip, and clamps none of its parts, at font scale %s',
            (scale) => {
                fontScale.current = scale;
                renderCard(
                    <RecipeCard
                        headingLevel={3}
                        variant={variant}
                        fullMeta
                        recipe={model({
                            totalTimeMinutes: 45,
                            difficulty: RecipeDifficulty.EASY,
                            averageRating: undefined,
                            ratingCount: 0,
                        })}
                        nutrition={<span>370 cal</span>}
                    />,
                );
                const line = screen.getByLabelText('45 minutes total time').parentElement as HTMLElement;
                const style = window.getComputedStyle(line);

                for (const part of ['Easy', 'No ratings yet', '370 cal']) {
                    expect(within(line).getByText(part)).toBeTruthy();
                }

                expect(style.flexWrap).toBe('wrap');
                expect(style.overflowX).not.toBe('hidden');
                expect(style.overflowY).not.toBe('hidden');
                expect(style.height).not.toMatch(/px/u);
                expect(style.maxHeight).not.toMatch(/px/u);

                for (const node of line.querySelectorAll<HTMLElement>('*')) {
                    const own = window.getComputedStyle(node);

                    expect(own.textOverflow).not.toBe('ellipsis');
                    expect(own.getPropertyValue('-webkit-line-clamp')).toBe('');
                    expect(own.overflowX).not.toBe('hidden');
                }
            },
        );
    },
);
