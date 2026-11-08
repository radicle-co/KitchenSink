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

/**
 * F10 (`evaluateFinal.md`): with no photo the hero drew a picture glyph in a 4:3 box, which reads as "the image failed".
 * The spec (§1.8, §6.7) is the 96 px `RecipeCover` band with the monogram: the title's first letter on a tint chosen by
 * the recipe id, decorative because the H1 already names the recipe. These replace the old glyph-placeholder tests.
 */
describe('RecipeHero (web) — no photo: the 96 px gradient band', () => {
    // REWRITTEN IN SLICE 1 (designer, `designAnswers.md` 2026-11-02, iosBatch1): the no-photo band on the recipe page is the
    // tint only, with no monogram letter and no cuisine label. Cards and thumbnails keep the monogram. The page's own cuisine
    // eyebrow is the one place the cuisine is said.
    const noPhoto = <RecipeHero title="Herb Risotto" photos={[]} />;

    it('draws a decorative band with no letter, no cuisine, no image and no picture glyph', () => {
        const { container } = renderHero(noPhoto);
        const band = container.querySelector('.h-24') as HTMLElement;

        expect(band.getAttribute('aria-hidden')).toBe('true');
        expect(band.textContent).toBe('');
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('svg')).toBeNull();
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText('H')).toBeNull();
    });

    // The ONE no-photo gradient the cards use (designer ruling C2): sky to cream at 170 degrees, alone on the band.
    it('paints the shared sky-to-cream gradient at 170 degrees', () => {
        const { container } = renderHero(noPhoto);
        const band = container.querySelector('.h-24') as HTMLElement;

        expect(band.className.split(' ')).toEqual(
            expect.arrayContaining(['bg-linear-[170deg]', 'from-cover-sky', 'to-cover-cream']),
        );
    });

    it('reserves the 96 px band, never the full hero box', () => {
        const { container } = renderHero(noPhoto);

        expect(container.querySelector('.h-24')).not.toBeNull();
        expect(container.querySelector('.h-64')).toBeNull();
    });
});

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
