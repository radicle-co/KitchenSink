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
import { Text } from 'react-native';

import { LocaleProvider } from '@commise/i18n/react';
import { gradient } from '@commise/ui';
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
        renderHero(<RecipeHero recipeId="rec_herb" title="Herb Risotto" photos={photos} />);

        expect(screen.getAllByLabelText('Recipe photos')).toHaveLength(1);
    });

    it('does NOT render the no-photo placeholder or a scrim when there are photos', () => {
        const { container } = renderHero(<RecipeHero recipeId="rec_herb" title="Herb Risotto" photos={photos} />);

        expect(screen.queryByLabelText('No photo yet')).toBeNull();
        expect(gradientLayers(container, SCRIM_FIRST_COLOR)).toHaveLength(0);
    });
});

/**
 * F10 (`evaluateFinal.md`): with no photo the hero drew a picture glyph in a box that ran past the right edge. The spec
 * (§1.8, §6.7) is the 96 px `RecipeCover` band with the monogram, decorative because the title already names the
 * recipe. These replace the old glyph-placeholder tests.
 */
describe('RecipeHero (native) — no photo: the 96 px monogram band', () => {
    const noPhoto = <RecipeHero recipeId="rec_herb" title="Herb Risotto" cuisine="Italian" photos={[]} />;

    it('draws the title’s first letter, with no image and no picture glyph', () => {
        const { container } = renderHero(noPhoto);

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('[data-icon-name="image"]')).toBeNull();
        expect(screen.queryByLabelText('No photo yet')).toBeNull();
        expect(screen.getByText('H')).toBeTruthy();
    });

    it('occupies the 96 pt band (mediaHeight.heroPlaceholder), never the full hero height', () => {
        const { container } = renderHero(noPhoto);
        const band = Array.from(container.querySelectorAll('div')).find(
            (node) => appliedStyle(node, 'height') === `${nativeTokens.mediaHeight.heroPlaceholder}px`,
        );

        expect(nativeTokens.mediaHeight.heroPlaceholder).toBe(96);
        expect(band).toBeDefined();
        expect(band?.textContent).toContain('H');
    });
});

describe('RecipeHero (native) — the overlay over the photo', () => {
    const photos = [makePhoto({ id: 'pho_0', url: 'https://cdn/p0.jpg' })];
    const overlay = (
        <>
            <Text accessibilityRole="button">Back</Text>
            <Text accessibilityRole="button">More actions</Text>
        </>
    );

    it.each([
        ['photos present', photos],
        ['no photo', []],
    ])('draws the overlay absolutely over the top of the hero (%s)', (_state, list) => {
        render(
            <LocaleProvider locale="en">
                <RecipeHero recipeId="rec_herb" title="Herb Risotto" photos={list} overlay={overlay} />
            </LocaleProvider>,
        );

        const layer = screen.getByRole('button', { name: 'Back' }).parentElement as HTMLElement;
        const style = getComputedStyle(layer);

        expect(style.position).toBe('absolute');
        expect(style.top).toBe('0px');
        // react-native-web draws `box-none` as `none` on the layer and `auto` on each child.
        expect(style.pointerEvents).toBe('none');
        expect(screen.getByRole('button', { name: 'More actions' }).parentElement).toBe(layer);
    });

    it('puts the overlay before the photos in the reading order', () => {
        render(
            <LocaleProvider locale="en">
                <RecipeHero recipeId="rec_herb" title="Herb Risotto" photos={photos} overlay={overlay} />
            </LocaleProvider>,
        );

        const back = screen.getByRole('button', { name: 'Back' });
        const [photo] = screen.getAllByLabelText('Recipe photos');

        if (photo === undefined) {
            throw new Error('no carousel');
        }

        expect(back.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
