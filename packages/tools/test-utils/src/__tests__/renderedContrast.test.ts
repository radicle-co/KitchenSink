/**
 * Invariants for the rendered-contrast readers. These ARE the measuring instrument every design-system
 * colour assertion in the monorepo now depends on, so each behaviour that could silently make a failing
 * surface look passing — a missed alpha composite, a variant read from the wrong utility, an ambiguous class
 * list measured as whichever token came first — is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { palette, role } from '@commise/ui/colors';

import { compositeOver, contrastRatio } from '../contrast.js';
import { computedContrast, placeholderContrast, ringContrast, utilityContrast } from '../renderedContrast.js';

describe('utilityContrast', () => {
    it('measures the palette pair the class list names', () => {
        expect(utilityContrast('text-charcoal bg-cloud')).toBeCloseTo(
            contrastRatio(palette.charcoal, palette.cloud),
            10,
        );
    });

    // Tailwind's own `white` is pure #FFFFFF (the palette no longer shadows it with the card colour), which is `snow`.
    // A class list that says `bg-white` is read as pure white, not skipped as an unknown name.
    it('reads Tailwind’s own white as snow, and the card colour only as cloud', () => {
        expect(utilityContrast('text-charcoal bg-white')).toBeCloseTo(
            contrastRatio(palette.charcoal, palette.snow),
            10,
        );
        expect(utilityContrast('text-charcoal bg-white')).not.toBeCloseTo(utilityContrast('text-charcoal bg-cloud'), 4);
    });

    it('treats an element with NO background utility as painted on the surface', () => {
        // A bare text button (`text-steel transition hover:bg-steel/10`) paints nothing at rest, so its
        // resting ratio is the token against the surface. Before this, such a button could not be measured at
        // rest at all — which is precisely where `text-steel` fails.
        expect(utilityContrast('text-steel transition hover:bg-steel/10')).toBeCloseTo(
            contrastRatio(palette.steel, palette.cloud),
            10,
        );
    });

    it('honours a non-white surface for a background-less element', () => {
        expect(utilityContrast('text-slate', { surface: palette.fog })).toBeCloseTo(
            contrastRatio(palette.slate, palette.fog),
            10,
        );
    });

    it('COMPOSITES a translucent background instead of scoring against the raw token', () => {
        // The tint is DERIVED from the token (`/10` → `1a` hex alpha), not re-spelled: a literal `#3D8B851a`
        // froze this expectation at the pre-#113 steel, so the token move broke a test of the READER rather
        // than of the palette.
        const composited = contrastRatio(palette['ocean-dark'], compositeOver(`${palette.steel}1a`, palette.cloud));

        expect(utilityContrast('text-ocean-dark bg-steel/10')).toBeCloseTo(composited, 10);
        // The un-composited reading is materially different — proof the composite step is doing work.
        expect(utilityContrast('text-ocean-dark bg-steel/10')).not.toBeCloseTo(
            contrastRatio(palette['ocean-dark'], palette.steel),
            1,
        );
    });

    it('prefers the requested variant and falls back to the base utility for the other half', () => {
        const hover = utilityContrast('text-slate bg-cream/10 hover:bg-cream/25', { variant: 'hover' });

        expect(hover).toBeCloseTo(contrastRatio(palette.slate, compositeOver(`${palette.cream}40`, palette.cloud)), 10);
        // The text has no `hover:` utility, so the hover state inherits the base label colour — a variant read
        // that silently dropped the base would measure nothing at all.
        expect(hover).not.toBeCloseTo(utilityContrast('text-slate bg-cream/10 hover:bg-cream/25'), 2);
    });

    it('skips type utilities that merely share the `text-` prefix', () => {
        expect(utilityContrast('text-body-sm text-caption font-medium text-charcoal')).toBeCloseTo(
            contrastRatio(palette.charcoal, palette.cloud),
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
            contrastRatio(palette.mist, palette.cloud),
            10,
        );
    });

    it('does not mistake sizing, side or non-palette border utilities for a colour', () => {
        // `border-2`, `border-b-2` and `border-l-[3px]` carry digits; `border-border` names a semantic token
        // that is not a palette key. If any of them resolved, the measurement would silently move.
        const cls = 'border-2 border-b-2 border-l-[3px] border-border border-slate';

        expect(utilityContrast(cls, { foreground: 'border' })).toBeCloseTo(
            contrastRatio(palette.slate, palette.cloud),
            10,
        );
    });

    it('reports which role was ambiguous or missing', () => {
        expect(() => utilityContrast('text-charcoal', { foreground: 'border' })).toThrow(/`border-\*`/);
        expect(() => utilityContrast('border-mist border-slate', { foreground: 'border' })).toThrow(/exactly ONE/);
    });
});

describe('ringContrast', () => {
    it('measures the ring token against the surface the ring is drawn on', () => {
        expect(ringContrast('rounded-full focus-visible:ring-2 focus-visible:ring-steel')).toBeCloseTo(
            contrastRatio(palette.steel, palette.cloud),
            10,
        );
    });

    it('IGNORES the element’s own fill, because a ring is drawn OUTSIDE the border box', () => {
        // This is the whole reason the reader exists. A selected filter chip is `bg-steel`; its ring is a
        // spread box-shadow on the PAGE, so the page is the backdrop. Scoring it like a border would compare
        // steel against steel (1:1) and a passing focus ring would look broken — or, with the fill and the
        // ring reversed, a broken one would look fine.
        const chip = 'bg-steel text-white focus-visible:ring-2 focus-visible:ring-steel';

        expect(ringContrast(chip, { surface: palette.fog })).toBeCloseTo(contrastRatio(palette.steel, palette.fog), 10);
        expect(ringContrast(chip, { surface: palette.fog })).toBeGreaterThan(3);
    });

    it('reads the ring whichever focus variant carries it', () => {
        const expected = contrastRatio(palette.steel, palette.cloud);

        expect(ringContrast('focus:ring-2 focus:ring-steel')).toBeCloseTo(expected, 10);
        expect(ringContrast('focus-within:ring-2 focus-within:ring-steel')).toBeCloseTo(expected, 10);
        expect(ringContrast('ring-2 ring-steel')).toBeCloseTo(expected, 10);
    });

    it('COMPOSITES a translucent backdrop, so a nested tint is not measured against the card', () => {
        // The chip-remove control's ring sits on the chip's own `bg-steel/10` over the white field — two
        // surfaces deep. Measuring it against a nominal white overstates the ratio.
        const tinted = compositeOver(`${palette.steel}1a`, palette.cloud);

        expect(ringContrast('focus-visible:ring-2 focus-visible:ring-steel', { surface: tinted })).toBeCloseTo(
            contrastRatio(palette.steel, tinted),
            10,
        );
        expect(ringContrast('focus-visible:ring-2 focus-visible:ring-steel', { surface: tinted })).toBeLessThan(
            ringContrast('focus-visible:ring-2 focus-visible:ring-steel'),
        );
    });

    it('applies a `/NN` suffix to the ring token', () => {
        expect(ringContrast('ring-2 ring-steel/50')).toBeCloseTo(
            contrastRatio(compositeOver(`${palette.steel}80`, palette.cloud), palette.cloud),
            10,
        );
    });

    it('does not mistake ring geometry utilities for a colour', () => {
        // `ring-2` and `ring-offset-2` carry digits; `ring-inset` and `ring-ring` name no palette key. If any
        // resolved, the measurement would silently move — or the single-ring check would spuriously throw.
        expect(ringContrast('ring-2 ring-offset-2 ring-inset ring-ring ring-steel')).toBeCloseTo(
            contrastRatio(palette.steel, palette.cloud),
            10,
        );
    });

    it('fails loudly when a control has NO ring, rather than measuring the surface against itself', () => {
        // `focus:outline-none` with no ring is a control with no focus indicator at all — a defect in its own
        // right, so it must throw instead of returning a comfortable 1:1-free number.
        expect(() => ringContrast('rounded-full focus:outline-none')).toThrow(/`ring-\*`/);
        expect(() => ringContrast('focus:ring-steel hover:ring-cream')).toThrow(/exactly ONE/);
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

        expect(computedContrast(element)).toBeCloseTo(contrastRatio(palette['ocean-dark'], palette.cloud), 5);
        expect(computedContrast(element, { surface: palette.fog })).toBeCloseTo(
            contrastRatio(palette['ocean-dark'], palette.fog),
            5,
        );
    });

    it('composites the element OWN translucent background over the surface', () => {
        const element = withStyle({ color: palette['ocean-dark'], backgroundColor: 'rgba(61, 139, 133, 0.1)' });
        const composited = compositeOver('rgba(61, 139, 133, 0.1)', palette.cloud);

        expect(computedContrast(element)).toBeCloseTo(contrastRatio(palette['ocean-dark'], composited), 5);
    });

    it.each([
        ['background', { color: palette.slate, backgroundColor: 'var(--paper)' }],
        ['text colour', { color: 'var(--ink)' }],
    ] as const)('refuses a %s that is an unresolved theme variable, naming the resolver', (_part, styles) => {
        // A Tamagui component paints through CSS variables, which jsdom keeps as text. Measuring past one would
        // compare against a default surface, not the colour a device paints.
        expect(() => computedContrast(withStyle(styles))).toThrow(/resolvedColour/u);
    });

    it('treats a fully transparent background as no background at all', () => {
        const element = withStyle({ color: palette.slate, backgroundColor: 'rgba(0, 0, 0, 0)' });

        expect(computedContrast(element)).toBeCloseTo(contrastRatio(palette.slate, palette.cloud), 5);
    });

    /**
     * ⚠️ REWRITTEN for jsdom 30, which reports `rgb(0, 0, 0)` for a DETACHED element where jsdom 24 reported
     * an empty string. The old assertion passed because of that empty string, so the bump did not merely
     * break the test — it revealed that the guard's mechanism had become unable to detect the thing the
     * guard exists for. It now refuses on `isConnected`, which is the condition the code always described.
     */
    it('refuses to measure an element that was never put in the document', () => {
        expect(() => computedContrast(document.createElement('div'))).toThrow(/in the document/);
    });

    it('measures an element that IS in the document and carries a colour', () => {
        // ⛔ Anti-vacuity for the guard above: if this threw too, the refusal would prove nothing.
        //
        // ⚠️ The colour is set EXPLICITLY rather than relying on a default, because the two jsdom
        // generations disagree about what an unstyled element reports — 24 gives an empty string, 30 gives
        // `rgb(0, 0, 0)`. Styling it means this asserts the guard's behaviour rather than the environment's.
        const attached = document.body.appendChild(document.createElement('div'));

        attached.style.color = '#2D3436';

        expect(() => computedContrast(attached)).not.toThrow();
        attached.remove();
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
        expect(placeholderContrast(element)).toBeCloseTo(contrastRatio(palette.mist, palette.cloud), 5);
        expect(placeholderContrast(element)).toBeLessThan(2);
    });

    it('honours the surface when the input paints no background of its own', () => {
        const element = withPlaceholderColor(palette.slate);

        element.style.backgroundColor = 'transparent';

        expect(placeholderContrast(element, { surface: palette.fog })).toBeCloseTo(
            contrastRatio(palette.slate, palette.fog),
            5,
        );
    });

    it('lets the input OWN opaque background win over the stated surface', () => {
        // A field painted `bg-cloud` on a fog page is read against cloud, not fog — which is why the
        // element's own background is consulted first rather than the caller's backdrop being trusted blindly.
        const element = withPlaceholderColor(palette.slate);

        element.style.backgroundColor = palette.cloud;

        expect(placeholderContrast(element, { surface: palette.fog })).toBeCloseTo(
            contrastRatio(palette.slate, palette.cloud),
            5,
        );
    });

    it('refuses to measure an input that paints no placeholder colour', () => {
        expect(() => placeholderContrast(document.createElement('input'))).toThrow(/placeholderTextColor/);
    });
});

/**
 * The colour ROLES (`@commise/ui/colors` `role`, emitted as `--color-{kebab}`) are the overhaul's vocabulary for
 * screens (spec §1.4), so a utility naming a role is a colour utility exactly as a palette name is.
 */
describe('the readers resolve colour roles as well as palette names', () => {
    it('measures a role-coloured label on a role-coloured fill', () => {
        expect(utilityContrast('bg-paper text-ink-muted')).toBeCloseTo(contrastRatio(role.inkMuted, role.paper), 5);
    });

    it('measures a role-coloured focus ring over its surface', () => {
        expect(
            ringContrast('focus-visible:ring-2 focus-visible:ring-focus-ring', { surface: role.canvas }),
        ).toBeCloseTo(contrastRatio(role.focusRing, role.canvas), 5);
    });

    it('still skips a type-role utility that shares the text- prefix', () => {
        expect(utilityContrast('text-label text-danger-text')).toBeCloseTo(
            contrastRatio(role.dangerText, palette.cloud),
            5,
        );
    });
});
