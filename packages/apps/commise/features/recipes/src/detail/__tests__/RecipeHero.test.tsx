// @vitest-environment jsdom
/**
 * Component tests for the web {@link RecipeHero} — the recipe-detail lead surface the mockup (`screenRecipeDetail`)
 * opens the screen with: the photo carousel, or a deliberate placeholder when the recipe has no photo.
 *
 * BOTH states are covered, because the interesting one is the absence: a recipe with no photo must look
 * DELIBERATE (a branded, labelled placeholder), never a broken image or a collapsed zero-height box. So these
 * pin, for the no-cover path: no `<img>` at all (not an `<img>` with an empty `src`, which browsers render as
 * a broken-image glyph), a localized accessible label, and that the hero still occupies its height.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { utilityContrast } from '@commise/test-utils';
import { gradient } from '@commise/ui';

import { makePhoto } from '../../__fixtures__/index.js';
import { RecipeHero } from '../RecipeHero.js';

afterEach(cleanup);

const renderHero = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

/**
 * F2 (`docs/design/uiOverhaul/evaluateRecipeAndWizard.md`): the hero painted the cover and a second carousel below
 * painted it again. The hero is now the ONE photo surface: the carousel, slide 1 the cover (the service's rule), built
 * from `photos` alone. These replace the old cover-image tests (its height, its scrim), whose element no longer exists;
 * the carousel's own geometry and lightbox are `PhotoCarousel.test.tsx`'s.
 */
describe('RecipeHero (web) — photos present: the hero IS the carousel', () => {
    const photos = [0, 1].map((index) =>
        makePhoto({ id: `pho_${String(index)}`, url: `https://cdn/p${String(index)}.jpg` }),
    );

    it('shows every photo once, the cover first', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={photos} />);

        expect(screen.getAllByRole('region', { name: 'Recipe photos' })).toHaveLength(1);
        expect(screen.getByRole('img', { name: 'Herb Risotto photo 1' }).getAttribute('src')).toBe(
            'https://cdn/p0.jpg',
        );
        expect(screen.getAllByRole('img')).toHaveLength(2);
    });

    it('does NOT render the no-photo placeholder when there are photos', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={photos} />);

        expect(screen.queryByRole('img', { name: 'No photo yet' })).toBeNull();
    });
});

describe('RecipeHero (web) — cover absent (the deliberate fallback)', () => {
    it('renders a localized, labelled placeholder instead of an image', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        // Labelled through the i18n seam (`card.noPhotoLabel`) — the SAME copy the card placeholder uses.
        expect(screen.getByRole('img', { name: 'No photo yet' })).toBeTruthy();
    });

    // The empty-state glyph size (spec §8, 48 px). Slice 2 first moved it onto the Registry at 24, a visible shrink
    // from the 64 px inline SVG it replaced that `recipeDetailDesktop.png` caught.
    it('draws the placeholder glyph at the 48 px empty-state size', () => {
        render(<RecipeHero title="Herb Risotto" photos={[]} />);

        const glyph = screen.getByRole('img', { name: 'No photo yet' }).querySelector('svg.lucide-image');

        expect(glyph?.getAttribute('width')).toBe('48');
    });

    it('renders NO <img> element at all (an empty src would paint a broken-image glyph)', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        expect(container.querySelector('img')).toBeNull();
    });

    it('still occupies the hero height, so the screen does not collapse or jump', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);
        const className = screen.getByRole('img', { name: 'No photo yet' }).className;

        expect(className).toContain('h-64');
        expect(className).toContain('md:h-96');
    });

    it('paints the placeholder with the brand hero gradient rather than an empty grey box', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        // `GradientSurface gradient="hero"` paints the canvas wash through the themed `bg-hero` utility (D15).
        expect(container.querySelector('.bg-hero')).not.toBeNull();
    });
});

describe('RecipeHero (web) — the no-cover placeholder is legible on the beach-glow ramp (WCAG 2.1 AA)', () => {
    it('keeps the labelled placeholder glyph above the AA floor on the WORST hero gradient stop', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        // A `role="img"` carrying a localized `aria-label` is a MEANINGFUL graphic (SC 1.4.11's 3:1 floor at
        // minimum), and here it is the ONLY thing drawn in the hero. `mist` measured 1.70:1 against the
        // gradient's coolest stop — under every floor there is. The native leaf already uses `palette.slate`;
        // this is the web half catching up. Rule stated once in `@commise/ui`'s `tokens/colors.ts` JSDoc.
        //
        // A gradient has no single backdrop, so the measurement takes the WORST (lightest) stop — clear that
        // and every point on the ramp is clear. The stop's colour is READ FROM THE TOKEN rather than spelled as
        // a hex, so re-toning the beach-glow ramp moves this test instead of silently invalidating it.
        const [, , coolestStop] = gradient.hero.stops;
        const placeholder = screen.getByRole('img', { name: 'No photo yet' });

        expect(
            utilityContrast(placeholder.className, { surface: coolestStop.color }),
            'no-cover hero glyph on the lightest hero-gradient stop',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * Slice 3's seam for slice 6 (D12): the back and ⋯ controls sit ON the photo. The hero takes them as an `overlay` and
 * places them over its top edge, in either state, FIRST in the reading order so Back is reached before the photos.
 */
describe('RecipeHero (web) — the overlay over the photo', () => {
    const photos = [makePhoto({ id: 'pho_0', url: 'https://cdn/p0.jpg' })];
    const overlay = (
        <>
            <button type="button">Back</button>
            <button type="button">More actions</button>
        </>
    );

    it.each([
        ['photos present', photos],
        ['no photo', []],
    ])('draws the overlay over the top of the hero (%s)', (_state, list) => {
        renderHero(<RecipeHero title="Herb Risotto" photos={list} overlay={overlay} />);

        const back = screen.getByRole('button', { name: 'Back' });
        const layer = back.parentElement;

        expect(layer?.className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'top-0', 'z-10']));
        expect(screen.getByRole('button', { name: 'More actions' }).parentElement).toBe(layer);
        expect(layer?.parentElement?.className.split(' ')).toContain('relative');
    });

    it('puts the overlay before the photos in the reading order', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={photos} overlay={overlay} />);

        const back = screen.getByRole('button', { name: 'Back' });
        const region = screen.getByRole('region', { name: 'Recipe photos' });

        expect(back.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('adds no wrapper when there is no overlay', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={photos} />);

        expect(container.querySelector('.relative > .absolute.top-0')).toBeNull();
    });
});
