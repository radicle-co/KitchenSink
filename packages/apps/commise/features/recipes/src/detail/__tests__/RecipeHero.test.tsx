// @vitest-environment jsdom
/**
 * Component tests for the web {@link RecipeHero} — the recipe-detail lead cover treatment the mockup
 * (`screen-recipe-detail`) opens the screen with: a full-width cover image under a bottom-up scrim.
 *
 * BOTH states are covered, because the interesting one is the absence: a recipe with no photo must look
 * DELIBERATE (a branded, labelled placeholder), never a broken image or a collapsed zero-height box. So these
 * pin, for the no-cover path: no `<img>` at all (not an `<img>` with an empty `src`, which browsers render as
 * a broken-image glyph), a localized accessible label, and that the hero still occupies its height.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeHero } from '../RecipeHero.js';

afterEach(cleanup);

const renderHero = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecipeHero (web) — cover present', () => {
    it('renders the cover photo, named by the recipe title', () => {
        renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);
        const img = screen.getByRole('img', { name: 'Herb Risotto' });

        expect(img.getAttribute('src')).toBe('https://cdn/hero.jpg');
    });

    it('paints the cover edge-to-edge at the mockup hero height (h-64, md:h-96)', () => {
        renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);
        const className = screen.getByRole('img', { name: 'Herb Risotto' }).className;

        expect(className).toContain('object-cover');
        expect(className).toContain('w-full');
    });

    it('lays a scrim over the cover so overlaid chrome stays legible on a light photo', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        // mockup: `absolute inset-0 bg-gradient-to-t from-charcoal/60 to-transparent`. The scrim is purely
        // decorative, so it must NOT be announced.
        const scrim = container.querySelector('[class*="from-charcoal/60"]');
        expect(scrim).not.toBeNull();
        expect(scrim?.getAttribute('aria-hidden')).toBe('true');
    });

    it('does NOT render the no-photo placeholder when a cover is present', () => {
        renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        expect(screen.queryByRole('img', { name: 'No photo yet' })).toBeNull();
    });
});

describe('RecipeHero (web) — cover absent (the deliberate fallback)', () => {
    it('renders a localized, labelled placeholder instead of an image', () => {
        renderHero(<RecipeHero title="Herb Risotto" />);

        // Labelled through the i18n seam (`card.noPhotoLabel`) — the SAME copy the card placeholder uses.
        expect(screen.getByRole('img', { name: 'No photo yet' })).toBeTruthy();
    });

    it('renders NO <img> element at all (an empty src would paint a broken-image glyph)', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" />);

        expect(container.querySelector('img')).toBeNull();
    });

    it('still occupies the hero height, so the screen does not collapse or jump', () => {
        renderHero(<RecipeHero title="Herb Risotto" />);
        const className = screen.getByRole('img', { name: 'No photo yet' }).className;

        expect(className).toContain('h-64');
        expect(className).toContain('md:h-96');
    });

    it('paints the placeholder with the brand hero gradient rather than an empty grey box', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" />);

        // `GradientSurface gradient="hero"` composes the beach-glow CSS gradient from the shared token.
        const surface = container.querySelector('[style*="linear-gradient"]');
        expect(surface).not.toBeNull();
    });

    it('does not render the cover scrim when there is no cover to darken', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" />);

        expect(container.querySelector('[class*="from-charcoal/60"]')).toBeNull();
    });
});
