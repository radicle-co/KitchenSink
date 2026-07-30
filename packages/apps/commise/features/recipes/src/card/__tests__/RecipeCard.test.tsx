// @vitest-environment jsdom
/**
 * Component tests for the web mockup-parity recipe card — every field and every state the mockup's list /
 * "Recent recipes" cards show, plus the domain's ABSENT states the mockup never depicts. Asserts on visible
 * text and accessible names (role/label), never on CSS classes, so a broken label, a fabricated rating, or a
 * defaulted difficulty fails — but a restyle does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@commise/i18n/react';
import { utilityContrast } from '@commise/test-utils';
import { glass, glassBackdropCss, palette, toWebGlass } from '@commise/ui';
import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCard } from '../RecipeCard.js';

afterEach(cleanup);

const model = (over = {}) => toRecipeCardModel(makeRecipe(over));

const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecipeCard (web)', () => {
    it('renders the title and names the card (article) by it', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('renders the total time and the servings count', () => {
        renderCard(<RecipeCard recipe={model({ totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByLabelText('Serves 4')).toBeTruthy();
    });

    it('renders the cover photo with the title as its alt text', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg' })} />);

        const img = screen.getByRole('img', { name: 'Herb Risotto' });
        expect(img.getAttribute('src')).toBe('https://cdn/x.jpg');
    });

    it('shows a labelled placeholder (no img) when the recipe has no photo', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: undefined })} />);

        expect(screen.queryByRole('img', { name: 'Herb Risotto' })).toBeNull();
        expect(screen.getByLabelText('No photo yet')).toBeTruthy();
    });

    it('shows the difficulty pill with the stated difficulty label', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: 'easy' })} />);
        expect(screen.getByText('Easy')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ difficulty: 'hard' })} />);
        expect(screen.getByText('Hard')).toBeTruthy();
    });

    it('renders NO difficulty pill when the author stated none (never a default "Medium")', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: undefined })} />);

        expect(screen.queryByText('Easy')).toBeNull();
        expect(screen.queryByText('Medium')).toBeNull();
        expect(screen.queryByText('Hard')).toBeNull();
    });

    it('shows the PRO badge (with an accessible name) when the recipe uses a premium capability', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: true })} />);

        expect(screen.getByLabelText('Premium recipe')).toBeTruthy();
        expect(screen.getByText('PRO')).toBeTruthy();
    });

    it('renders NO PRO badge when the recipe does not use a premium capability', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByText('PRO')).toBeNull();
        expect(screen.queryByLabelText('Premium recipe')).toBeNull();
    });

    it('exposes a rated recipe as a star image named by the Intl-formatted average and pluralized count', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 4.5, ratingCount: 12 })} />);

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('pluralizes a single rating in the accessible summary', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 5, ratingCount: 1 })} />);

        expect(screen.getByRole('img', { name: 'Rated 5.0 out of 5, 1 rating' })).toBeTruthy();
    });

    it('shows the unrated state (no fabricated stars/score) when there are no ratings', () => {
        renderCard(<RecipeCard recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        // No star-rating image is rendered — an unrated recipe has no average to depict.
        expect(screen.queryByRole('img', { name: /Rated/ })).toBeNull();
    });

    it('is a non-interactive article when no onSelect is given (the Home widget card)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('is an actionable button reporting the recipe id when onSelect is given (the list card)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderCard(<RecipeCard recipe={model({ id: 'rec_42', title: 'Herb Risotto' })} onSelect={onSelect} />);

        const button = screen.getByRole('button', { name: 'Herb Risotto' });
        await user.click(button);

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });

    it('keeps the meta (time/servings) inside the card region', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', totalTimeMinutes: 35 })} />);

        const region = screen.getByRole('article', { name: 'Herb Risotto' });
        expect(within(region).getByText('35 min')).toBeTruthy();
    });
});

describe('RecipeCard (web) — U8 brand treatment', () => {
    it('carries the tokenized md card elevation on the shell', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        // The shared shell (list + widget) RESTS at the `shadow-md` token (a standalone class, distinct from
        // any `hover:shadow-*` lift), giving the card real depth.
        const article = screen.getByRole('article', { name: 'Herb Risotto' });
        expect(article.className.split(/\s+/)).toContain('shadow-md');
    });

    it('wraps the actionable (list) card in the reduced-motion-safe press-scale primitive', () => {
        const { container } = renderCard(
            <RecipeCard recipe={model({ title: 'Herb Risotto' })} onSelect={() => undefined} />,
        );

        // PressScale (web) is a span carrying the motion-safe active-scale utility; the interactive button
        // it wraps is the child that drives the scale (reduce-motion is gated inside the utility).
        const press = container.querySelector('[class*="motion-safe:active:scale-[0.98]"]');
        expect(press).not.toBeNull();
        expect(press?.querySelector('button')).not.toBeNull();
    });

    it('adds NO press motion to the non-interactive widget card (no onSelect)', () => {
        const { container } = renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(container.querySelector('[class*="motion-safe:active:scale-[0.98]"]')).toBeNull();
    });

    it('paints the NON-INTERACTIVE card shell with the brand frosted-glass surface (mockup home/recipes grid)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);
        const article = screen.getByRole('article', { name: 'Herb Risotto' });

        // The surface comes from the SAME `glass.card` token the `GlassCard` primitive paints — asserted
        // against the token projection, not a hardcoded rgba, so a token change moves both together.
        expect(article.style.backgroundColor).toBe(toWebGlass(glass.card, true).backgroundColor);
        expect(article.style.backdropFilter).toBe(glassBackdropCss(glass.card));
    });

    it('paints the ACTIONABLE card shell with the same glass surface (the interactive element, not a wrapper)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} onSelect={() => undefined} />);
        const button = screen.getByRole('button', { name: 'Herb Risotto' });

        // On the actionable form the glass must land on the <button> itself — painting the outer wrapper
        // instead would leave the interactive surface transparent and its hover states glass-less.
        expect(button.style.backgroundColor).toBe(toWebGlass(glass.card, true).backgroundColor);
        expect(button.style.backdropFilter).toBe(glassBackdropCss(glass.card));
    });

    it('drops the opaque bg-card fill that the frosted surface replaces', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        // `bg-card` (solid white) would paint OVER the translucent surface and cancel the whole treatment.
        expect(screen.getByRole('article', { name: 'Herb Risotto' }).className.split(/\s+/)).not.toContain('bg-card');
    });

    it('carries the glass hairline from the TOKEN, not a re-spelled Tailwind literal', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);
        const className = screen.getByRole('article', { name: 'Herb Risotto' }).className;

        // The edge is the SAME `glass.card.border` the native leaf already consumes as `cardGlass.border`,
        // reaching web as the emitted `--color-glass-card-edge` utility. `border-white/30` was that identical
        // value spelled a second way — the drift this converges.
        expect(className).toContain('border-glass-card-edge');
        expect(className).not.toContain('border-white/30');
        // Still a 1px edge, not just a colour with no border-width.
        expect(className.split(/\s+/)).toContain('border');
        // The hover EMPHASIS deliberately stays a literal — see the component's note. It must survive, since a
        // colour applied by inline style (the other way to reach the token) would silently out-specify it.
        expect(className).toContain('hover:border-white/40');
    });

    it('keeps the hairline in CLASS position so the hover variant can still win', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);
        const article = screen.getByRole('article', { name: 'Herb Risotto' });

        // Inline styles beat every class, so painting the edge via `style` would kill `hover:border-*`
        // outright. The glass FILL is inline (it has no hover variant); the edge must not be.
        expect(article.style.borderColor).toBe('');
        expect(article.style.borderTopColor).toBe('');
    });
});

describe('RecipeCard (web) — merged fields (CR-002 / L2·L3)', () => {
    it('renders the cuisine when present, and nothing when absent', () => {
        renderCard(<RecipeCard recipe={model({ cuisine: 'Mediterranean' })} />);
        expect(screen.getByText('Mediterranean')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ cuisine: undefined, title: 'No Cuisine' })} />);
        expect(screen.queryByText('Mediterranean')).toBeNull();
    });

    it('renders the localized calorie line when present, and none when absent', () => {
        renderCard(<RecipeCard recipe={model({ leadCaloriesPerServing: 420 })} />);
        expect(screen.getByText('420 cal')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ leadCaloriesPerServing: undefined, title: 'No Cal' })} />);
        expect(screen.queryByText(/cal$/)).toBeNull();
    });

    it('renders each tag as a chip', () => {
        renderCard(<RecipeCard recipe={model({ tags: ['grill', 'summer'] })} />);

        expect(screen.getByText('grill')).toBeTruthy();
        expect(screen.getByText('summer')).toBeTruthy();
    });

    it('gives the tag chip a WCAG-AA legible label over its warm tint', () => {
        renderCard(<RecipeCard recipe={model({ tags: ['grill'] })} />);

        // Measured, not eyeballed: the chip's own rendered utilities are resolved to palette colours and the
        // tint is composited onto the card beneath it. Coral-as-text over `bg-coral/10` scored 2.21:1 — less
        // than half the 4.5:1 floor for body text — which is exactly what the native leaf already fixed by
        // demoting the LABEL to slate while keeping the warm tint.
        expect(utilityContrast(screen.getByText('grill').className)).toBeGreaterThanOrEqual(4.5);
    });

    it('gives the CUISINE badge a WCAG-AA legible label over its seafoam tint', () => {
        renderCard(<RecipeCard recipe={model({ cuisine: 'Mediterranean' })} />);

        // Same defect as the tag chip above, in the other hue: seafoam-as-text on `bg-seafoam/10` is 3.57:1.
        expect(utilityContrast(screen.getByText('Mediterranean').className), 'cuisine badge').toBeGreaterThanOrEqual(
            4.5,
        );
    });

    it('gives the VISIBILITY badge a WCAG-AA legible label over the same seafoam tint', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'published' })} />);

        expect(utilityContrast(screen.getByText('Public').className), 'visibility badge').toBeGreaterThanOrEqual(4.5);
    });

    it('shows the version badge past v1 (with an accessible name), and hides it at v1', () => {
        renderCard(<RecipeCard recipe={model({ currentVersion: 12 })} />);
        expect(screen.getByLabelText('Version 12').textContent).toBe('v12');

        cleanup();
        renderCard(<RecipeCard recipe={model({ currentVersion: 1 })} />);
        expect(screen.queryByLabelText('Version 1')).toBeNull();
    });

    it('shows a visibility badge (Public / Private) for a published recipe', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'published' })} />);
        expect(screen.getByText('Public')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ visibility: 'private', status: 'published' })} />);
        expect(screen.getByText('Private')).toBeTruthy();
    });

    it('shows a Draft badge that REPLACES the visibility badge for a draft (never "Public" on a draft)', () => {
        // A free-tier draft carries visibility='public' but is community-invisible — showing "Public" misleads.
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'draft' })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByText('Public')).toBeNull();
        expect(screen.queryByText('Private')).toBeNull();
    });
});

describe('RecipeCard (web) — relative timestamp (CR-002 / recipe-list wireframe)', () => {
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

describe('RecipeCard (web) — non-text graphics stay legible (WCAG 2.1 AA)', () => {
    /**
     * An `<svg>`'s `className` is an `SVGAnimatedString`, NOT a string — `utilityContrast(svg.className)`
     * would measure an object. The rendered class list comes off the attribute instead.
     */
    const classListOf = (element: Element): string => element.getAttribute('class') ?? '';

    it('draws the EMPTY star pips in a legible tone — they carry the "out of 5" scale', () => {
        // average 2 of 5 → pips 3, 4 and 5 render EMPTY, which is what the scale is read from.
        renderCard(<RecipeCard recipe={model({ averageRating: 2, ratingCount: 3 })} />);

        // The native leaf (`RecipeCard.native.tsx`) demoted these to `slate` in the U4 pass and says why: an
        // empty pip is the half of the readout that states the SCALE, so it is meaning-bearing, not decoration.
        // The web half was never brought along and stayed on `mist` at 1.90:1 — under even the 3:1 SC 1.4.11
        // floor. The rule is stated ONCE in the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
        const pips = [...screen.getByRole('img', { name: /out of 5/ }).querySelectorAll('svg')];

        expect(pips).toHaveLength(5);
        for (const [index, pip] of pips.slice(2).entries()) {
            expect(
                utilityContrast(classListOf(pip)),
                `empty star pip ${index + 3} of 5 on the card surface`,
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps the labelled no-cover placeholder glyph legible on its pearl tile', () => {
        renderCard(<RecipeCard recipe={model({ coverPhotoUrl: undefined })} />);

        // A `role="img"` carrying a localized `aria-label` is a MEANINGFUL graphic, not a decorative rule — so
        // it owes at least the 3:1 of SC 1.4.11, and it is the only thing drawn in the tile. `mist` measured
        // 1.74:1 against the `bg-pearl` tile it is painted on (the placeholder itself paints no background, so
        // the tile IS its surface), which clears nothing.
        const placeholder = screen.getByRole('img', { name: 'No photo yet' });

        expect(
            utilityContrast(placeholder.className, { surface: palette.pearl }),
            'no-cover placeholder glyph on the pearl cover tile',
        ).toBeGreaterThanOrEqual(4.5);
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

describe('RecipeCard (web) — labels on FILLED accents (WCAG 2.1 AA, #113)', () => {
    // Every one of these is a label on an OPAQUE brand fill, which is the pairing #113 found broken across ~35
    // call sites: `text-white` reads 2.72:1 on `bg-success`, 2.23:1 on `bg-premium` and 1.88:1 on `bg-warning`.
    // The three difficulty tones share ONE map, so measuring all three is what stops a "fix" that repairs the
    // tone under test and leaves its neighbours illegible.
    it.each(DIFFICULTY_PILLS)('reads the $label difficulty pill on its filled $tone fill', ({ difficulty, label }) => {
        renderCard(<RecipeCard recipe={model({ difficulty })} />);

        expect(utilityContrast(screen.getByText(label).className), `${label} difficulty pill`).toBeGreaterThanOrEqual(
            4.5,
        );
    });

    it('reads the PRO badge on its filled premium fill', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: true })} />);

        // `premium` is a GOLD. Darkening it enough to carry a white label turns it bronze, so the badge takes a
        // dark label (5.70:1) and the gold survives — see the filled-accent contract in `tokens/colors.ts`.
        expect(utilityContrast(screen.getByLabelText('Premium recipe').className), 'PRO badge').toBeGreaterThanOrEqual(
            4.5,
        );
    });
});
