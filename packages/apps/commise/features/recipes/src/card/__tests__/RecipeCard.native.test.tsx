/**
 * Native component tests for the mockup-parity recipe card (rendered via react-native-web under jsdom).
 * Mirrors the web leaf's coverage — every field and every ABSENT state — but queries the RN accessibility
 * tree (role/label/text), never styles. A broken label, a fabricated rating, or a defaulted difficulty fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';

import { LocaleProvider } from '@commise/i18n/react';
import { computedContrast } from '@commise/test-utils';
import { palette, tint } from '@commise/ui';
import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCard } from '../RecipeCard.native.js';

afterEach(cleanup);

const model = (over = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecipeCard (native)', () => {
    it('renders the title, total time, and servings', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByLabelText('Serves 4')).toBeTruthy();
    });

    // #140 — the cover photo used to carry `accessibilityLabel={recipe.title}`, the SAME accessible name as the
    // pressable that contains it. A screen reader then announced the recipe twice for one card: once for the
    // control the viewer can activate, once for its own decorative photo. A cover with no alternative text of
    // its own (the model carries none) is decoration, so it belongs OUT of the accessibility tree entirely.
    it('keeps the cover photo out of the accessibility tree — it is decoration, not a second name', () => {
        const { container } = renderCard(
            <RecipeCard
                recipe={model({ title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg', ratingCount: 0 })}
            />,
        );

        // No image node at all: the cover is the only image this card draws once the rating row is unrated.
        expect(screen.queryAllByRole('img')).toHaveLength(0);
        expect(screen.queryByRole('img', { name: 'Herb Risotto' })).toBeNull();
        // Still PAINTED — hidden from assistive tech, not removed from the card.
        const cover = container.querySelector('img[src="https://cdn/x.jpg"]');
        expect(cover).not.toBeNull();
        expect(cover?.closest('[aria-hidden="true"]'), 'cover is not inside a hidden subtree').not.toBeNull();
    });

    it('names the actionable card exactly ONCE (the pressable), never twice', () => {
        renderCard(
            <RecipeCard
                recipe={model({ title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg', ratingCount: 0 })}
                onSelect={() => undefined}
            />,
        );

        // Every node in the tree answering to the recipe's name, by any naming mechanism.
        expect(screen.getAllByRole('button', { name: 'Herb Risotto' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Herb Risotto')).toHaveLength(1);
        expect(screen.queryByAltText('Herb Risotto')).toBeNull();
    });

    it('shows a labelled placeholder (no cover image) when the recipe has no photo', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: undefined })} />);

        // The ABSENCE of a photo is information a sighted viewer gets from the empty tile, so unlike the cover
        // this placeholder stays named — with its own copy, never the recipe's name.
        expect(screen.queryByRole('img', { name: 'Herb Risotto' })).toBeNull();
        expect(screen.getByRole('img', { name: 'No photo yet' })).toBeTruthy();
    });

    it('shows the stated difficulty pill', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: 'hard' })} />);
        expect(screen.getByText('Hard')).toBeTruthy();
    });

    it('renders NO difficulty pill when the author stated none', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: undefined })} />);

        expect(screen.queryByText('Easy')).toBeNull();
        expect(screen.queryByText('Medium')).toBeNull();
        expect(screen.queryByText('Hard')).toBeNull();
    });

    it('shows the PRO badge with an accessible name when premium', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: true })} />);

        expect(screen.getByLabelText('Premium recipe')).toBeTruthy();
        expect(screen.getByText('PRO')).toBeTruthy();
    });

    it('renders NO PRO badge when not premium', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByText('PRO')).toBeNull();
    });

    it('exposes a rated recipe as a star image named by the Intl average and pluralized count', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 4.5, ratingCount: 12 })} />);

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows the unrated state (no fabricated stars) when there are no ratings', () => {
        renderCard(<RecipeCard recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /Rated/ })).toBeNull();
    });

    // U4 contrast (WCAG AA): a rated-but-all-empty row (average 0) renders 5 empty pips — each must be the
    // AA-legible slate, not the old 1.9:1 mist.
    it('renders empty star pips in slate (AA), not the 1.9:1 mist', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 0, ratingCount: 3 })} />);

        const pips = screen.getAllByText('★');
        expect(pips).toHaveLength(5);

        for (const pip of pips) {
            expect(window.getComputedStyle(pip).color).toBe('rgb(99, 110, 114)');
        }
    });

    it('is non-interactive (no button) when no onSelect is given (the Home widget card)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('is an actionable button reporting the recipe id when onSelect is given (the list card)', () => {
        const onSelect = vi.fn();
        renderCard(<RecipeCard recipe={model({ id: 'rec_42', title: 'Herb Risotto' })} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: 'Herb Risotto' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });
});

/**
 * iOS clips a layer's drop shadow when the SAME layer sets `overflow: 'hidden'` — so a card that both
 * elevates and clips its cover image renders flat on iOS (Android's `elevation` is unaffected, which is
 * exactly why this regressed silently). The fix is structural: the shadow lives on a NON-clipping outer
 * shell, the clip on the inner content view. These assertions read the real computed style, so they fail if
 * the two ever collapse back onto one node.
 */
const domNodes = (container: HTMLElement): readonly HTMLElement[] => [...container.querySelectorAll<HTMLElement>('*')];
/** Nodes painting a drop shadow (react-native-web compiles RN `shadow*` props to a `box-shadow` rule). */
const shadowed = (container: HTMLElement): readonly HTMLElement[] =>
    domNodes(container).filter((node) => window.getComputedStyle(node).boxShadow !== '');
/** Nodes that clip their overflow — the layers that would mask a co-located shadow on iOS. */
const clipping = (container: HTMLElement): readonly HTMLElement[] =>
    domNodes(container).filter((node) => window.getComputedStyle(node).overflowX === 'hidden');

describe.each([
    ['non-interactive widget card', undefined],
    ['actionable list card', () => undefined],
] as const)('RecipeCard (native) — iOS shadow clipping (%s)', (_name, onSelect) => {
    const renderVariant = () =>
        renderCard(
            <RecipeCard
                recipe={model({ id: 'rec_9', title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg' })}
                {...(onSelect === undefined ? {} : { onSelect })}
            />,
        );

    it('paints the card elevation on exactly ONE node', () => {
        const { container } = renderVariant();

        const elevated = shadowed(container);
        expect(elevated).toHaveLength(1);
        // The tokenized `md` elevation, not an ad-hoc shadow.
        expect(window.getComputedStyle(elevated[0]!).boxShadow).toBe('0px 4px 6px rgba(45,52,54,0.07)');
    });

    it('keeps the elevated node NON-clipping (iOS would otherwise mask its own shadow)', () => {
        const { container } = renderVariant();

        expect(window.getComputedStyle(shadowed(container)[0]!).overflowX).not.toBe('hidden');
    });

    it('never puts a shadow and a clip on the same node', () => {
        const { container } = renderVariant();

        for (const node of clipping(container)) {
            expect(window.getComputedStyle(node).boxShadow).toBe('');
        }
    });

    it('clips the cover INSIDE the elevated shell (the clip moved in, it was not dropped)', () => {
        const { container } = renderVariant();

        const shell = shadowed(container)[0]!;
        // The cover image is still clipped to the rounded corners — by a content view NESTED in the shell,
        // never by the shell itself.
        const coverClip = clipping(container).find((node) => node !== shell && node.querySelector('img') !== null);
        expect(coverClip).toBeDefined();
        expect(shell.contains(coverClip!)).toBe(true);
    });

    it('gives the elevated shell a PAINTED surface (iOS casts no shadow from a fully transparent layer)', () => {
        const { container } = renderVariant();
        const background = window.getComputedStyle(shadowed(container)[0]!).backgroundColor;

        // The invariant is that the elevated layer is PAINTED, not that it is opaque white: since U8's glass
        // treatment the fill is the tier's translucent `surface` (an opaque fill would paint over the
        // translucency and cancel the frost). What must never happen is a fully transparent shell, which iOS
        // would cast no shadow from at all.
        expect(background).not.toBe('');
        expect(background).not.toBe('rgba(0, 0, 0, 0)');
        expect(background).not.toBe('transparent');
    });
});

describe('RecipeCard (native) — U8 brand treatment', () => {
    it('wraps the actionable card in a single press-feedback button (no nested pressables)', () => {
        const onSelect = vi.fn();
        renderCard(<RecipeCard recipe={model({ id: 'rec_7', title: 'Herb Risotto' })} onSelect={onSelect} />);

        // PressScale (native) OWNS the Pressable — there must be exactly ONE button (a stray inner Pressable
        // from a botched wrap would surface as a second button), named by the title, still reporting the id.
        const buttons = screen.getAllByRole('button', { name: 'Herb Risotto' });
        expect(buttons).toHaveLength(1);

        fireEvent.click(buttons[0]!);
        expect(onSelect).toHaveBeenCalledWith('rec_7');
    });

    it('adds NO press button to the non-interactive widget card (no onSelect)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('RecipeCard (native) — merged fields (CR-002 / L2·L3)', () => {
    it('renders the cuisine when present, and nothing when absent', () => {
        renderCard(<RecipeCard recipe={model({ cuisine: 'Mediterranean' })} />);
        expect(screen.getByText('Mediterranean')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ cuisine: undefined, title: 'No Cuisine' })} />);
        expect(screen.queryByText('Mediterranean')).toBeNull();
    });

    // REPLACES "renders the localized calorie line when present, and none when absent" — same reasoning as the
    // web leaf: calories left the card model with the deferred lookup, and the card now owns only the SLOT.
    // The figure's own states are covered in `nutrition/__tests__/RecipeCalorieChip.native.test.tsx`.
    it('renders whatever the nutrition slot supplies, inside the meta row', () => {
        renderCard(<RecipeCard recipe={model({ totalTimeMinutes: 45 })} nutrition={<Text>420 cal</Text>} />);

        expect(screen.getByText('420 cal')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
    });

    it('renders NO nutrition line at all when the slot is absent — never a placeholder, never a zero', () => {
        renderCard(<RecipeCard recipe={model({ title: 'No Cal' })} />);

        expect(screen.queryByText(/cal$/)).toBeNull();
        expect(screen.queryByText('0 cal')).toBeNull();
    });

    it('renders each tag as a chip', () => {
        renderCard(<RecipeCard recipe={model({ tags: ['grill', 'summer'] })} />);

        expect(screen.getByText('grill')).toBeTruthy();
        expect(screen.getByText('summer')).toBeTruthy();
    });

    // U4 contrast (WCAG AA) — the one place this suite asserts computed colour rather than the a11y tree,
    // because a colour fix is not observable in the tree.
    it('renders tag chips with a slate (AA-legible) text colour, not the 2.2:1 coral', () => {
        renderCard(<RecipeCard recipe={model({ tags: ['grill'] })} />);

        expect(window.getComputedStyle(screen.getByText('grill')).color).toBe('rgb(99, 110, 114)');
    });

    // The cuisine and visibility chips share ONE `styles.chip` (tint + text tone), so both are measured: a
    // regression to either would show up on both surfaces. The ratio is read from the leaf's own compiled
    // style and its own tint, so re-theming the palette moves the measurement rather than passing anyway.
    it('makes the cuisine chip label legible over its own seafoam tint', () => {
        renderCard(<RecipeCard recipe={model({ cuisine: 'Mediterranean' })} />);

        expect(computedContrast(screen.getByText('Mediterranean')), 'cuisine chip label').toBeGreaterThanOrEqual(4.5);
    });

    it('makes the visibility chip label legible over that same tint', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'published' })} />);

        expect(computedContrast(screen.getByText('Public')), 'visibility chip label').toBeGreaterThanOrEqual(4.5);
    });

    it('shows the version badge past v1 and hides it at v1', () => {
        renderCard(<RecipeCard recipe={model({ currentVersion: 12 })} />);
        expect(screen.getByText('v12')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ currentVersion: 1 })} />);
        expect(screen.queryByText('v1')).toBeNull();
    });

    it('shows a visibility badge (Public / Private) for a published recipe', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'published' })} />);
        expect(screen.getByText('Public')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ visibility: 'private', status: 'published' })} />);
        expect(screen.getByText('Private')).toBeTruthy();
    });

    it('shows a Draft badge that REPLACES the visibility badge for a draft', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'draft' })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByText('Public')).toBeNull();
        expect(screen.queryByText('Private')).toBeNull();
    });
});

describe('RecipeCard (native) — relative timestamp (CR-002 / recipe-list wireframe)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders "Edited {relative}" when the recipe was revised after it was created', () => {
        renderCard(
            <RecipeCard
                recipe={model({
                    createdAt: '2026-06-01T12:00:00.000Z',
                    updatedAt: '2026-07-22T12:00:00.000Z',
                })}
            />,
        );

        expect(screen.getByText('Edited 2d ago')).toBeTruthy();
    });

    it('renders "Created {relative}" (never "Edited") when the recipe has never been revised', () => {
        renderCard(
            <RecipeCard
                recipe={model({
                    createdAt: '2026-07-17T12:00:00.000Z',
                    updatedAt: '2026-07-17T12:00:00.000Z',
                })}
            />,
        );

        expect(screen.getByText('Created 1w ago')).toBeTruthy();
        expect(screen.queryByText(/^Edited/)).toBeNull();
    });
});

/** Each difficulty and the semantic tone whose FILL its pill paints — the map both platform leaves share. */
const DIFFICULTY_PILLS: readonly {
    readonly difficulty: RecipeDifficulty;
    readonly label: string;
    readonly tone: string;
}[] = [
    { difficulty: RecipeDifficulty.EASY, label: 'Easy', tone: 'success' },
    { difficulty: RecipeDifficulty.MEDIUM, label: 'Medium', tone: 'warning' },
    { difficulty: RecipeDifficulty.HARD, label: 'Hard', tone: 'error' },
];

describe('RecipeCard (native) — labels on FILLED accents (WCAG 2.1 AA, #113)', () => {
    // The native mirror of the web card's filled-accent assertions. Both platforms had `palette.white` on
    // `palette.success` (2.72:1) and on `palette.premium` (2.23:1); measuring both leaves is what keeps a fix
    // to one platform from silently leaving the other behind — the divergence class this issue also found in
    // the step marker.
    it.each(DIFFICULTY_PILLS)(
        'reads the $label difficulty pill on its own filled $tone fill',
        ({ difficulty, label }) => {
            renderCard(<RecipeCard recipe={model({ difficulty })} />);

            expect(computedContrast(screen.getByText(label)), `${label} difficulty pill`).toBeGreaterThanOrEqual(4.5);
        },
    );

    it('reads the PRO badge on its filled premium fill', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: true })} />);

        expect(computedContrast(screen.getByText('PRO')), 'PRO badge').toBeGreaterThanOrEqual(4.5);
    });

    it('paints the cuisine chip tint from the seafoam TOKEN, not a frozen rgba() literal', () => {
        renderCard(<RecipeCard recipe={model({ cuisine: 'Mediterranean' })} />);

        // The tint used to be spelled `rgba(61, 139, 133, 0.1)` by hand. That is the pre-#113 seafoam, so the
        // token move left web's `bg-seafoam/10` and this chip painting two DIFFERENT teals — a divergence no
        // ratio assertion catches, because both still cleared the floor.
        expect(window.getComputedStyle(screen.getByText('Mediterranean')).backgroundColor).toBe(
            tint(palette.seafoam, 0.1),
        );
    });

    it('paints the tag chip tint from the coral TOKEN', () => {
        renderCard(<RecipeCard recipe={model({ tags: ['grill'] })} />);

        expect(window.getComputedStyle(screen.getByText('grill')).backgroundColor).toBe(tint(palette.coral, 0.1));
    });
});
