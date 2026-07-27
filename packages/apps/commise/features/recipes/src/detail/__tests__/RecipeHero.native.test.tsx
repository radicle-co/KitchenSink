/**
 * Native component tests for {@link RecipeHero} — the recipe-detail lead cover treatment (mockup
 * `screen-recipe-detail`), rendered via react-native-web under jsdom.
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
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { gradient, palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeHero } from '../RecipeHero.native.js';

afterEach(cleanup);

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

describe('RecipeHero (native) — cover present', () => {
    it('renders the cover photo, named by the recipe title', () => {
        renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        expect(screen.getByLabelText('Herb Risotto')).toBeTruthy();
    });

    it('sources the cover from the recipe cover URL', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        // The `expo-image` stub records its `source` uri, so this pins that the hero paints the cover the
        // card paints — NOT `photos[0]`, which would let the hero and the card disagree.
        expect(container.innerHTML).toContain('https://cdn/hero.jpg');
    });

    it('paints the cover at the FULL hero height (the mockup h-64 phone value)', () => {
        renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        expect(appliedStyle(screen.getByLabelText('Herb Risotto'), 'height')).toBe(
            `${nativeTokens.mediaHeight.hero}px`,
        );
    });

    it('lays a decorative scrim over the cover so the image foot stays tonally anchored', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);
        const [scrim, ...extra] = gradientLayers(container, SCRIM_FIRST_COLOR);

        expect(scrim).toBeDefined();
        expect(extra).toHaveLength(0);
    });

    it('keeps the scrim purely decorative — it names nothing and announces nothing', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);
        const [scrim] = gradientLayers(container, SCRIM_FIRST_COLOR);

        // On native a view is only an accessibility element when it is `accessible` or carries a role/label/
        // text. The scrim must have none of those, so a screen reader walks straight past it to the cover.
        expect(scrim?.getAttribute('role')).toBeNull();
        expect(scrim?.getAttribute('aria-label')).toBeNull();
        expect(scrim?.textContent).toBe('');
        // And the hero as a whole exposes exactly ONE named node: the cover itself.
        expect(container.querySelectorAll('[aria-label]')).toHaveLength(1);
    });

    it('does NOT paint the beach-glow hero gradient behind a real cover photo', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        // The brand gradient is the PLACEHOLDER's surface. Painting it under a photo would be dead work and
        // would stack a second beach-glow panel against the detail's existing title band.
        expect(gradientLayers(container, palette.sand)).toHaveLength(0);
    });

    it('does NOT render the no-photo placeholder when a cover is present', () => {
        renderHero(<RecipeHero title="Herb Risotto" coverPhotoUrl="https://cdn/hero.jpg" />);

        expect(screen.queryByLabelText('No photo yet')).toBeNull();
    });
});

describe('RecipeHero (native) — cover absent (the deliberate fallback)', () => {
    it('renders a localized, labelled placeholder instead of an image', () => {
        renderHero(<RecipeHero title="Herb Risotto" />);

        // Labelled through the i18n seam (`card.noPhotoLabel`) — the SAME copy the card placeholder uses,
        // so "no photo yet" is stated once in the dictionary and read identically on both surfaces.
        expect(screen.getByLabelText('No photo yet')).toBeTruthy();
    });

    it('renders NO image element at all (an empty source paints a broken-image glyph)', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" />);

        expect(container.querySelector('img')).toBeNull();
    });

    it('paints the placeholder on the brand hero gradient rather than an empty grey box', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" />);

        expect(gradientLayers(container, palette.sand)).toHaveLength(1);
    });

    it('occupies the COMPACT placeholder band, not the full hero height', () => {
        renderHero(<RecipeHero title="Herb Risotto" />);
        const height = appliedStyle(screen.getByLabelText('No photo yet'), 'height');

        // The deliberate native divergence, asserted in BOTH directions: an empty full-height hero would
        // push the title off a phone's first screen, so the band is compact — and must NOT be the hero box.
        expect(height).toBe(`${nativeTokens.mediaHeight.heroPlaceholder}px`);
        expect(height).not.toBe(`${nativeTokens.mediaHeight.hero}px`);
    });

    it('still occupies a real height, so the screen never collapses to nothing', () => {
        renderHero(<RecipeHero title="Herb Risotto" />);

        expect(nativeTokens.mediaHeight.heroPlaceholder).toBeGreaterThan(0);
        expect(appliedStyle(screen.getByLabelText('No photo yet'), 'height')).not.toBe('0px');
    });

    it('does not render the cover scrim when there is no cover to anchor', () => {
        const { container } = renderHero(<RecipeHero title="Herb Risotto" />);

        // A scrim here would darken a placeholder that has no photo to darken — and would drag the label's
        // contrast down with it.
        expect(gradientLayers(container, SCRIM_FIRST_COLOR)).toHaveLength(0);
    });
});
