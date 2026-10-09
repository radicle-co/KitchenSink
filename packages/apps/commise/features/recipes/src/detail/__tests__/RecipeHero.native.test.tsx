/**
 * Native component tests for {@link RecipeHero} — the recipe-detail lead cover treatment (mockup
 * `screenRecipeDetail`), rendered via react-native-web under jsdom.
 *
 * BOTH states are covered, because the interesting one is the ABSENCE of a cover. A missing cover must look
 * DELIBERATE, and specifically must not be an `<Image>` with an empty `source` (which paints a broken-image
 * glyph on device exactly as the browser does).
 *
 * The native no-cover arm DELIBERATELY DIVERGES from web on ONE axis — height. Web's fallback fills the full
 * hero box (`h-64`/`md:h-96`); on a phone that is an empty gradient panel occupying most of the first screen,
 * stacked directly above the detail's EXISTING beach-glow title band, so it reads as a rendering fault rather
 * than a design. Native therefore paints a COMPACT placeholder band. These tests pin that divergence in both
 * directions (compact present AND full-hero absent) so neither platform can silently drift into the other's
 * geometry.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { gradient, palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { makePhoto } from '../../__fixtures__/index.js';
import { RecipeHero } from '../RecipeHero.native.js';

/** Resize the window: react-native-web's `Dimensions` reads the root element's height on a resize event. */
function windowHeight(height: number): void {
    Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

// An upright phone unless a test turns it: the hero's height is capped by the window (`compactHeightLayout.md` §8).
beforeEach(() => windowHeight(851));

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
});

const renderHero = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

/**
 * The gradient stub records its projected colours on `data-colors`, so a test can say WHICH brand gradient a
 * surface paints rather than merely that some gradient exists. Identifying the layer by its token colours is
 * what makes the scrim-vs-hero assertions mutation-proof: swapping one token for the other fails.
 */
const gradientLayers = (container: HTMLElement, firstColor: string): readonly Element[] =>
    Array.from(container.querySelectorAll('[data-commise-stub="linear-gradient"]')).filter((node) =>
        (node.getAttribute('data-colors') ?? '').startsWith(firstColor),
    );

/** The scrim's own first stop — charcoal at 60%, the mockup's `from-charcoal/60`. */
const SCRIM_FIRST_COLOR = gradient.scrim.stops[0].color;

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules. `getComputedStyle` does not resolve these, and a `style`
 * attribute check would miss `StyleSheet.create` styles entirely — so this is the only honest read of the
 * geometry that ships. Mirrors the `appliedFontFamily` helper in `RecipeDetailView.native.test.tsx`.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    // A size computed per render (the window-capped hero) lands inline, not in a compiled class.
    const inline = (element as HTMLElement).style.getPropertyValue(property);

    if (inline !== '') {
        return inline;
    }

    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return resolved;
}

/**
 * F2 — mirrors the web leaf: the hero IS the photo carousel, built from `photos` alone, so the cover is shown once.
 * These replace the old cover-image tests (its window-capped height, its scrim), whose element no longer exists; the
 * carousel sizes itself from the same window cap (`carouselBox`), pinned in `PhotoCarousel.native.test.tsx`.
 */
describe('RecipeHero (native) — photos present: the hero IS the carousel', () => {
    const photos = [makePhoto({ url: 'https://cdn/p0.jpg' })];

    it('renders the photo carousel as the lead surface', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={photos} />);

        expect(screen.getAllByLabelText('Recipe photos')).toHaveLength(1);
    });

    it('does NOT render the no-photo placeholder or a scrim when there are photos', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={photos} />);

        expect(screen.queryByLabelText('No photo yet')).toBeNull();
        expect(gradientLayers(container, SCRIM_FIRST_COLOR)).toHaveLength(0);
    });
});

describe('RecipeHero (native) — cover absent (the deliberate fallback)', () => {
    it('renders a localized, labelled placeholder instead of an image', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        // Labelled through the i18n seam (`card.noPhotoLabel`) — the SAME copy the card placeholder uses,
        // so "no photo yet" is stated once in the dictionary and read identically on both surfaces.
        expect(screen.getByLabelText('No photo yet')).toBeTruthy();
    });

    it('draws the placeholder glyph at the 48 pt empty-state size (spec §8)', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        const glyph = screen.getByLabelText('No photo yet').querySelector<HTMLElement>('[data-commise-stub="icon"]');

        expect(glyph?.dataset['iconName']).toBe('image');
        expect(glyph?.dataset['iconSize']).toBe('48');
    });

    it('renders NO image element at all (an empty source paints a broken-image glyph)', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        expect(container.querySelector('img')).toBeNull();
    });

    it('paints the placeholder on the brand hero gradient rather than an empty grey box', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        expect(gradientLayers(container, palette.sand)).toHaveLength(1);
    });

    it('occupies the COMPACT placeholder band, not the full hero height', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);
        const height = appliedStyle(screen.getByLabelText('No photo yet'), 'height');

        // The deliberate native divergence, asserted in BOTH directions: an empty full-height hero would
        // push the title off a phone's first screen, so the band is compact — and must NOT be the hero box.
        expect(height).toBe(`${nativeTokens.mediaHeight.heroPlaceholder}px`);
        expect(height).not.toBe(`${nativeTokens.mediaHeight.hero}px`);
    });

    it('still occupies a real height, so the screen never collapses to nothing', () => {
        renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        expect(nativeTokens.mediaHeight.heroPlaceholder).toBeGreaterThan(0);
        expect(appliedStyle(screen.getByLabelText('No photo yet'), 'height')).not.toBe('0px');
    });

    it('does not render the cover scrim when there is no cover to anchor', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" photos={[]} />);

        // A scrim here would darken a placeholder that has no photo to darken — and would drag the label's
        // contrast down with it.
        expect(gradientLayers(container, SCRIM_FIRST_COLOR)).toHaveLength(0);
    });
});
