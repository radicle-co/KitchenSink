/**
 * Native component tests for the recipe card's U8 FROSTED-GLASS surface (rendered via react-native-web under
 * jsdom). Split out from `RecipeCard.native.test.tsx` because the blur-capability probe has to be mocked to
 * reach both branches, and that mock should not be imposed on the card's ~60 unrelated field assertions
 * (mirroring how `CollectionDetailScreen.pullGuard.native.test.tsx` isolates its own concern).
 *
 * Both capability states are covered, and the UNSUPPORTED one is the load-bearing case. `expo-blur` only
 * blurs for real on iOS/web: on Android its `blurMethod` defaults to `'none'` and it renders a plain
 * translucent `View`. A card that painted the translucent tint there anyway would ship a washed-out,
 * unblurred panel — a surface designed to sit over a blur, sitting over nothing. So the no-blur path must
 * take the tier's more-opaque solid `fallback` instead, and these tests fail if it silently doesn't.
 *
 * The structural invariants (elevation on exactly one non-clipping node, the cover clipped INSIDE it) are
 * re-asserted per branch: the glass rework moves which node paints what, and iOS masks a layer's own drop
 * shadow the moment that layer clips — so a regression there is invisible on Android and flat on iOS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { glass, toNativeGlass } from '@commise/ui';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCard } from '../RecipeCard.native.js';

/** Mutable capability flag, hoisted so the `vi.mock` factory below can close over it. */
const support = vi.hoisted(() => ({ blur: true }));

// Override ONLY the capability probe; every other surface export (GradientSurface, GlassCard, the tokens)
// stays real, so the card still composes the genuine primitives.
vi.mock('@commise/ui/surface', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/surface')>()),
    isBlurSupported: () => support.blur,
}));

afterEach(cleanup);

beforeEach(() => {
    support.blur = true;
});

const spec = toNativeGlass(glass.card);
const model = (over = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

const domNodes = (container: HTMLElement): readonly HTMLElement[] => [...container.querySelectorAll<HTMLElement>('*')];
const shadowed = (container: HTMLElement): readonly HTMLElement[] =>
    domNodes(container).filter((node) => window.getComputedStyle(node).boxShadow !== '');
const clipping = (container: HTMLElement): readonly HTMLElement[] =>
    domNodes(container).filter((node) => window.getComputedStyle(node).overflowX === 'hidden');
/** The `expo-blur` stub marks its view, so the frosted path is distinguishable from the solid fallback. */
const blurLayer = (container: HTMLElement): HTMLElement | null =>
    container.querySelector<HTMLElement>('[data-commise-stub="blur-view"]');

/** Both card forms must carry the glass: the Home widget's plain card and the list's actionable card. */
const variants = [
    ['non-interactive widget card', undefined],
    ['actionable list card', () => undefined],
] as const;

describe.each(variants)('RecipeCard (native) — glass supported (%s)', (_name, onSelect) => {
    const renderVariant = () =>
        renderCard(
            <RecipeCard
                recipe={model({ id: 'rec_9', title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg' })}
                {...(onSelect === undefined ? {} : { onSelect })}
            />,
        );

    it('paints the card on a real blur layer', () => {
        const { container } = renderVariant();

        expect(blurLayer(container)).not.toBeNull();
    });

    it('projects the tier blur through toNativeGlass rather than an ad-hoc intensity', () => {
        const { container } = renderVariant();
        const layer = blurLayer(container);

        expect(layer?.getAttribute('data-intensity')).toBe(String(spec.intensity));
        expect(layer?.getAttribute('data-tint')).toBe(spec.tint);
    });

    it('fills the blur layer with the TRANSLUCENT tier surface (an opaque fill cancels the frost)', () => {
        const { container } = renderVariant();

        // The whole point of the treatment: the page background must show through and be blurred. An opaque
        // white fill here would render an ordinary solid card that merely costs a blur pass.
        expect(window.getComputedStyle(blurLayer(container)!).backgroundColor).toBe(spec.surface);
    });

    it('edges the card with the tier translucent hairline, not an opaque border', () => {
        const { container } = renderVariant();
        // `borderTopColor`, not the `borderColor` shorthand: jsdom does not synthesise the shorthand from the
        // longhands react-native-web emits, so the shorthand reads a misleading "black" on every node.
        const edged = domNodes(container).filter(
            (node) => window.getComputedStyle(node).borderTopColor === spec.border,
        );

        expect(edged).toHaveLength(1);
        // The hairline belongs to the CLIPPING inner layer, never to the elevated shell.
        expect(window.getComputedStyle(edged[0]!).overflowX).toBe('hidden');
    });

    it('keeps the elevation on exactly ONE node, and that node does not clip', () => {
        const { container } = renderVariant();
        const elevated = shadowed(container);

        expect(elevated).toHaveLength(1);
        expect(window.getComputedStyle(elevated[0]!).overflowX).not.toBe('hidden');
    });

    it('still clips the cover INSIDE the elevated layer', () => {
        const { container } = renderVariant();
        const shell = shadowed(container)[0]!;
        const coverClip = clipping(container).find((node) => node !== shell && node.querySelector('img') !== null);

        expect(coverClip).toBeDefined();
        expect(shell.contains(coverClip!)).toBe(true);
    });
});

describe.each(variants)('RecipeCard (native) — glass UNSUPPORTED (%s)', (_name, onSelect) => {
    const renderVariant = () => {
        support.blur = false;

        return renderCard(
            <RecipeCard
                recipe={model({ id: 'rec_9', title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg' })}
                {...(onSelect === undefined ? {} : { onSelect })}
            />,
        );
    };

    it('renders NO blur layer at all — no pointless blur pass on a host that cannot blur', () => {
        const { container } = renderVariant();

        expect(blurLayer(container)).toBeNull();
    });

    it('degrades to the more-opaque SOLID fallback, never the translucent surface', () => {
        const { container } = renderVariant();
        const shell = shadowed(container)[0]!;
        const background = window.getComputedStyle(shell).backgroundColor;

        // This is the honest-degradation assertion: shipping `spec.surface` here would be a translucent panel
        // with nothing blurred behind it — legible-by-luck, and visibly wrong over a busy background.
        expect(background).toBe(spec.fallback);
        expect(background).not.toBe(spec.surface);
    });

    it('keeps the elevation on exactly ONE non-clipping node in the fallback shape too', () => {
        const { container } = renderVariant();
        const elevated = shadowed(container);

        expect(elevated).toHaveLength(1);
        expect(window.getComputedStyle(elevated[0]!).overflowX).not.toBe('hidden');
    });

    it('still clips the cover INSIDE the elevated layer in the fallback shape', () => {
        const { container } = renderVariant();
        const shell = shadowed(container)[0]!;
        const coverClip = clipping(container).find((node) => node !== shell && node.querySelector('img') !== null);

        expect(coverClip).toBeDefined();
        expect(shell.contains(coverClip!)).toBe(true);
    });

    it('still renders the card content (the fallback is a surface swap, not a degraded card)', () => {
        const { container } = renderVariant();

        expect(container.textContent).toContain('Herb Risotto');
    });
});
