/**
 * Contrast invariants for the shared web auth chrome (`/account`, `/settings`, `/profile`).
 *
 * `authChrome` is a module of pure class recipes, and its `field` string is the ONE surface every control on
 * those three routes wears. That makes it exactly the shape of defect #114 was: a single wrong token in a
 * shared recipe is an accessibility failure on every auth route at once, while looking like a local styling
 * choice at each call site. So the recipe is measured HERE, at the source, in addition to whatever the
 * consuming form tests assert.
 *
 * A focus indicator is a non-text UI component boundary, so its floor is the 3:1 of SC 1.4.11 — not the 4.5:1
 * of body text. It is measured against the surface the ring is DRAWN ON (the `sectionCard`'s `bg-card`), never
 * against the field's own white fill: a Tailwind `ring-*` is a spread box-shadow OUTSIDE the border box, so
 * the fill is not what a reader sees the ring against. `ringContrast` is the reader that encodes that.
 */
import { describe, expect, it } from 'vitest';

import { ringContrast } from '@commise/test-utils';
import { palette, semantic } from '@commise/ui';

import { field, sectionCard } from '@/components/auth/authChrome';

/** WCAG 2.1 AA, SC 1.4.11 — a focus indicator is a non-text UI component boundary. */
const AA_UI_COMPONENT = 3;

describe('authChrome — the field focus ring clears the 3:1 SC 1.4.11 floor', () => {
    it('sits on the section card, which is what the ring is measured against', () => {
        // Load-bearing: if the card stops being `bg-card`, the surface below is the wrong backdrop and this
        // test starts measuring a pair no reader sees.
        expect(sectionCard).toContain('bg-card');
    });

    it('rings the auth field legibly against the card it sits on', () => {
        // `seafoam-light` measured 2.78:1 here — the defect. The token is deliberately NOT darkened (it is the
        // light teal of `semantic.primary`; the lightness a ring needs would collapse it into `seafoam`), so
        // the fix is the token this recipe points at.
        expect(ringContrast(field, { surface: semantic.card }), 'auth field focus ring on the section card') //
            .toBeGreaterThanOrEqual(AA_UI_COMPONENT);
    });

    it('also clears the floor on the app background, for a field outside a card', () => {
        expect(
            ringContrast(field, { surface: semantic.background }),
            'auth field focus ring on the app background',
        ).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
    });

    it('suppresses the browser outline, so the ring is the WHOLE focus indicator', () => {
        // This is why the ring's ratio is not cosmetic: with `outline-none` there is no second indicator to
        // fall back on. A future edit that keeps `outline-none` and drops the ring would leave the field with
        // no focus affordance at all — `ringContrast` throws on a ring-less class list, so it cannot pass.
        expect(field).toContain('outline-none');
        expect(field).toMatch(/focus:ring-\d/);
    });

    it('out-measures the `seafoam-light` it replaced, so a re-theme cannot quietly restore the defect', () => {
        expect(ringContrast(field, { surface: semantic.card })).toBeGreaterThan(
            ringContrast('ring-2 ring-seafoam-light', { surface: semantic.card }),
        );
    });

    it('fixes the CALL SITE, not the token — `seafoam-light` is still too light to be a ring', () => {
        // The alternative fix was to darken `seafoam-light`. It was rejected: the token IS the light teal of
        // `semantic.primary`, and the lightness a 3:1 ring needs (ΔL 0.125) would collapse it into `seafoam`.
        // Asserting that it still FAILS the ring floor is what keeps that decision from being quietly undone
        // by someone "fixing" the palette instead — and it costs no hex literal here.
        expect(
            ringContrast('ring-2 ring-seafoam-light', { surface: semantic.card }),
            'seafoam-light must remain an accent, not a ring token',
        ).toBeLessThan(AA_UI_COMPONENT);
        expect(palette['seafoam-light'], 'seafoam-light IS semantic.primary').toBe(semantic.primary);
    });
});
