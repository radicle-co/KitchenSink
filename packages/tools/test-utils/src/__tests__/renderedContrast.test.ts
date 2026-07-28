/**
 * Invariants for the rendered-contrast readers. These ARE the measuring instrument every design-system
 * colour assertion in the monorepo now depends on, so each behaviour that could silently make a failing
 * surface look passing — a missed alpha composite, a variant read from the wrong utility, an ambiguous class
 * list measured as whichever token came first — is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { palette } from '@commise/ui';

import { compositeOver, contrastRatio } from '../contrast.js';
import { computedContrast, placeholderContrast, utilityContrast } from '../renderedContrast.js';

describe('utilityContrast', () => {
    it('measures the palette pair the class list names', () => {
        expect(utilityContrast('text-charcoal bg-white')).toBeCloseTo(
            contrastRatio(palette.charcoal, palette.white),
            10,
        );
    });

    it('treats an element with NO background utility as painted on the surface', () => {
        // A bare text button (`text-seafoam transition hover:bg-seafoam/10`) paints nothing at rest, so its
        // resting ratio is the token against the surface. Before this, such a button could not be measured at
        // rest at all — which is precisely where `text-seafoam` fails.
        expect(utilityContrast('text-seafoam transition hover:bg-seafoam/10')).toBeCloseTo(
            contrastRatio(palette.seafoam, palette.white),
            10,
        );
    });

    it('honours a non-white surface for a background-less element', () => {
        expect(utilityContrast('text-slate', { surface: palette.sand })).toBeCloseTo(
            contrastRatio(palette.slate, palette.sand),
            10,
        );
    });

    it('COMPOSITES a translucent background instead of scoring against the raw token', () => {
        const composited = contrastRatio(palette['ocean-dark'], compositeOver('#3D8B851a', palette.white));

        expect(utilityContrast('text-ocean-dark bg-seafoam/10')).toBeCloseTo(composited, 10);
        // The un-composited reading is materially different — proof the composite step is doing work.
        expect(utilityContrast('text-ocean-dark bg-seafoam/10')).not.toBeCloseTo(
            contrastRatio(palette['ocean-dark'], palette.seafoam),
            1,
        );
    });

    it('prefers the requested variant and falls back to the base utility for the other half', () => {
        const hover = utilityContrast('text-slate bg-coral/10 hover:bg-coral/25', { variant: 'hover' });

        expect(hover).toBeCloseTo(contrastRatio(palette.slate, compositeOver('#E8917A40', palette.white)), 10);
        // The text has no `hover:` utility, so the hover state inherits the base label colour — a variant read
        // that silently dropped the base would measure nothing at all.
        expect(hover).not.toBeCloseTo(utilityContrast('text-slate bg-coral/10 hover:bg-coral/25'), 2);
    });

    it('skips type utilities that merely share the `text-` prefix', () => {
        expect(utilityContrast('text-body-sm text-caption font-medium text-charcoal')).toBeCloseTo(
            contrastRatio(palette.charcoal, palette.white),
            10,
        );
    });

    it('refuses to guess when the foreground is missing or ambiguous', () => {
        expect(() => utilityContrast('bg-white')).toThrow(/exactly ONE/);
        expect(() => utilityContrast('text-charcoal text-slate bg-white')).toThrow(/exactly ONE/);
    });

    it('refuses to guess when two background utilities apply at the same level', () => {
        expect(() => utilityContrast('text-charcoal bg-white bg-pearl')).toThrow(/at most ONE/);
    });

    it('measures the BORDER when asked, so an unlabelled outlined control is assertable', () => {
        // An unchecked checkbox has no label of its own — its border is the whole of what makes it
        // perceivable, which is why SC 1.4.11 governs it and why `text` alone could never reach it.
        const cls = 'flex size-8 rounded border-2 border-mist bg-transparent';

        expect(utilityContrast(cls, { foreground: 'border' })).toBeCloseTo(
            contrastRatio(palette.mist, palette.white),
            10,
        );
    });

    it('does not mistake sizing, side or non-palette border utilities for a colour', () => {
        // `border-2`, `border-b-2` and `border-l-[3px]` carry digits; `border-border` names a semantic token
        // that is not a palette key. If any of them resolved, the measurement would silently move.
        const cls = 'border-2 border-b-2 border-l-[3px] border-border border-slate';

        expect(utilityContrast(cls, { foreground: 'border' })).toBeCloseTo(
            contrastRatio(palette.slate, palette.white),
            10,
        );
    });

    it('reports which role was ambiguous or missing', () => {
        expect(() => utilityContrast('text-charcoal', { foreground: 'border' })).toThrow(/`border-\*`/);
        expect(() => utilityContrast('border-mist border-slate', { foreground: 'border' })).toThrow(/exactly ONE/);
    });
});

describe('computedContrast', () => {
    /** Render a bare element carrying inline styles, the way react-native-web's atomic CSS resolves. */
    const withStyle = (styles: Record<string, string>): Element => {
        const element = document.createElement('div');

        Object.assign(element.style, styles);
        document.body.append(element);

        return element;
    };

    it('measures the leaf colour the DOM actually computed against the given surface', () => {
        const element = withStyle({ color: palette['ocean-dark'] });

        expect(computedContrast(element)).toBeCloseTo(contrastRatio(palette['ocean-dark'], palette.white), 5);
        expect(computedContrast(element, { surface: palette.sand })).toBeCloseTo(
            contrastRatio(palette['ocean-dark'], palette.sand),
            5,
        );
    });

    it('composites the element OWN translucent background over the surface', () => {
        const element = withStyle({ color: palette['ocean-dark'], backgroundColor: 'rgba(61, 139, 133, 0.1)' });
        const composited = compositeOver('rgba(61, 139, 133, 0.1)', palette.white);

        expect(computedContrast(element)).toBeCloseTo(contrastRatio(palette['ocean-dark'], composited), 5);
    });

    it('treats a fully transparent background as no background at all', () => {
        const element = withStyle({ color: palette.slate, backgroundColor: 'rgba(0, 0, 0, 0)' });

        expect(computedContrast(element)).toBeCloseTo(contrastRatio(palette.slate, palette.white), 5);
    });

    it('refuses to measure an element that carries no colour', () => {
        expect(() => computedContrast(document.createElement('div'))).toThrow(/computed `color`/);
    });
});

describe('placeholderContrast', () => {
    /** An input painted the way react-native-web paints `placeholderTextColor` — via a custom property. */
    const withPlaceholderColor = (color: string, textColor = palette.charcoal): HTMLInputElement => {
        const element = document.createElement('input');

        element.style.color = textColor;
        element.style.setProperty('--placeholderTextColor', color);
        document.body.append(element);

        return element;
    };

    it('measures the PLACEHOLDER colour, not the input own text colour', () => {
        const element = withPlaceholderColor(palette.mist, palette.charcoal);

        // The distinction is the whole point: charcoal-on-white is 12.68:1, so a reader of the input's `color`
        // would call an illegible mist placeholder a pass.
        expect(placeholderContrast(element)).toBeCloseTo(contrastRatio(palette.mist, palette.white), 5);
        expect(placeholderContrast(element)).toBeLessThan(2);
    });

    it('honours the surface when the input paints no background of its own', () => {
        const element = withPlaceholderColor(palette.slate);

        element.style.backgroundColor = 'transparent';

        expect(placeholderContrast(element, { surface: palette.sand })).toBeCloseTo(
            contrastRatio(palette.slate, palette.sand),
            5,
        );
    });

    it('lets the input OWN opaque background win over the stated surface', () => {
        // A field painted `bg-white` on a sand page is read against white, not sand — which is why the
        // element's own background is consulted first rather than the caller's backdrop being trusted blindly.
        const element = withPlaceholderColor(palette.slate);

        element.style.backgroundColor = palette.white;

        expect(placeholderContrast(element, { surface: palette.sand })).toBeCloseTo(
            contrastRatio(palette.slate, palette.white),
            5,
        );
    });

    it('refuses to measure an input that paints no placeholder colour', () => {
        expect(() => placeholderContrast(document.createElement('input'))).toThrow(/placeholderTextColor/);
    });
});
