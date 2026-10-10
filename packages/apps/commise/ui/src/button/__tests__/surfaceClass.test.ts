/**
 * Invariants for {@link buttonSurfaceClass} — the single authoritative web class recipe for the design-system Button
 * surface, which a control that cannot be a `<button>` (a navigation link, a Radix slot) wears verbatim.
 *
 * ⚠️ REWRITTEN in slice 2 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §1.4, §1.6, §1.10). The pins this
 * file used to hold — secondary as the mockups' CORAL-outlined glass, coral on hover, slate label — were overruled by
 * the owner ("Coral leaves every control", `ownerDecisions.md`). Secondary is now neutral (`paper`, a `lineControl`
 * edge, an `ink` label), there is a `ghost` tier, three sizes, a filled destructive surface that only a confirm dialog
 * asks for, the `focusRing` role and a 40% disabled state. What survived: the 44 px touch floor that only a fine pointer
 * resets (E2 I12), and the radius at HALF the height rather than a full pill (E2 I2, kept against spec §1.6 by
 * `docs/architecture/uiOverhaulBlueprint.md`, "Changes to the build spec" 3).
 *
 * Colours are read OUT of the class string and resolved through the tokens, then measured, so a re-themed token moves
 * the ratio and a repointed utility moves the lookup: neither can pass by spelling alone.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { palette, role } from '../../tokens/colors.js';
import { kebab } from '../../tokens/emit.js';
import { BUSY_CONTROL_CLASS } from '../busyControlProps.js';
import type { ButtonSize } from '../props.js';
import { GHOST_EDGE_CLASS, buttonSurfaceClass } from '../surfaceClass.js';

/** Every colour a utility can name: the palette, and the roles under their emitted kebab names (`ink-muted`). */
const COLOURS: Readonly<Record<string, string>> = {
    ...palette,
    ...Object.fromEntries(Object.entries(role).map(([name, value]) => [kebab(name), value])),
};

/** WCAG 2.x: 4.5:1 for text (SC 1.4.3), 3:1 for a UI component boundary such as a focus ring (SC 1.4.11). */
const AA_TEXT = 4.5;
const AA_UI_COMPONENT = 3;

/** Every surface the four tiers and two destructive tones produce, at the default size. */
const SURFACES: readonly { readonly name: string; readonly className: string }[] = [
    { name: 'primary', className: buttonSurfaceClass('primary') },
    { name: 'secondary', className: buttonSurfaceClass('secondary') },
    { name: 'ghost', className: buttonSurfaceClass('ghost') },
    { name: 'destructive inline', className: buttonSurfaceClass('destructive') },
    { name: 'destructive confirm', className: buttonSurfaceClass('destructive', 'md', 'confirm') },
];

const SIZES: readonly ButtonSize[] = ['lg', 'md', 'sm'];

/** The tokens of a class string. */
const tokensOf = (className: string): readonly string[] => className.split(/\s+/u);

/**
 * The colour a utility of one kind paints at rest (no variant prefix), resolved through the tokens.
 *
 * @throws Error unless exactly one such utility names a known colour.
 */
function restingColour(className: string, kind: 'text' | 'bg' | 'border' | 'from'): string {
    const found = tokensOf(className)
        .map((token) => new RegExp(`^${kind}-([a-z][a-z-]*)$`, 'u').exec(token)?.[1])
        .filter((name): name is string => name !== undefined && name in COLOURS);

    if (found.length !== 1) {
        throw new Error(`Expected one resting ${kind}-* colour in "${className}", found [${found.join(', ')}].`);
    }

    return COLOURS[found[0] as string] as string;
}

/** The colour of the focus ring a surface paints. */
function ringColour(className: string): string {
    const name = /(?:^|\s)focus-visible:ring-([a-z][a-z-]*)(?=\s|$)/u.exec(className)?.[1];

    if (name === undefined || !(name in COLOURS)) {
        throw new Error(`Expected a focus-visible:ring-* colour in "${className}".`);
    }

    return COLOURS[name] as string;
}

/** The fill a label sits on: the surface's own fill, or `paper` for a tier that paints none. */
function fillOf(className: string): string {
    const hasFill = tokensOf(className).some(
        (token) => /^(bg|from)-[a-z]/u.test(token) && !token.startsWith('bg-gradient'),
    );

    if (!hasFill) {
        return role.paper;
    }

    return tokensOf(className).some((token) => token.startsWith('from-'))
        ? restingColour(className, 'from')
        : restingColour(className, 'bg');
}

describe('buttonSurfaceClass — geometry', () => {
    /**
     * E2 I12 — the floor follows the POINTER, not the width: a touch screen keeps 44 px at every width and only a mouse
     * at md: and up gets the desktop density. Applies to the default `md` size, the one the mouse reset was made for.
     */
    it('keeps the 44px floor for touch at every width, and resets it only for a fine pointer at md:', () => {
        for (const { name, className } of SURFACES) {
            expect(tokensOf(className), name).toContain('min-h-11');
            expect(tokensOf(className), name).toContain('md:pointer-fine:min-h-0');
            expect(tokensOf(className), name).not.toContain('md:min-h-0');
        }
    });

    it('sizes lg at 52, md at 44 and sm at 36 visual px', () => {
        expect(tokensOf(buttonSurfaceClass('primary', 'lg'))).toContain('min-h-13');
        expect(tokensOf(buttonSurfaceClass('primary', 'md'))).toContain('min-h-11');
        expect(tokensOf(buttonSurfaceClass('primary', 'sm'))).toContain('min-h-9');
    });

    it('gives the 36px sm button a 44px hit area, by an overlay four px above and below it', () => {
        const tokens = tokensOf(buttonSurfaceClass('secondary', 'sm'));

        expect(tokens).toContain('relative');
        expect(tokens).toContain("before:content-['']");
        expect(tokens).toContain('before:absolute');
        expect(tokens).toContain('before:-inset-y-1');
        expect(tokens).toContain('before:inset-x-0');
    });

    /**
     * E2 I2 — the radius is HALF the height at every size, not a full pill: on one line the browser clamps it to half
     * the box (a pill), and a label that wraps at 200% text becomes a rounded rectangle whose words stay inside the
     * curve. Read against each size's own height step, so the two cannot drift.
     */
    it('rounds every size to half its height, never to a full pill', () => {
        for (const size of SIZES) {
            const className = buttonSurfaceClass('primary', size);
            const step = /(?:^|\s)min-h-(\d+)(?=\s|$)/u.exec(className)?.[1];

            expect(step, size).toBeDefined();
            expect(className, size).toContain(`rounded-[calc(var(--spacing)*${Number(step) / 2})]`);
            expect(className, size).not.toContain('rounded-full');
        }
    });

    it('lays out every tier as an inline-flex icon+label row', () => {
        for (const { name, className } of SURFACES) {
            expect(tokensOf(className), name).toEqual(expect.arrayContaining(['inline-flex', 'items-center']));
        }
    });

    /**
     * F5 (`evaluateFinal.md`): a flex row squeezed "Sort: Recently edited" to three lines at every width. A button never
     * shrinks below its label in a row, so the row wraps BETWEEN controls, never inside one; `max-w-full` keeps a label
     * longer than its whole container (200% text, §1.1's standing exception) wrapping inside the box, never overflowing.
     */
    it('never shrinks below its label in a flex row, and never grows past its container', () => {
        for (const variant of ['primary', 'secondary', 'ghost'] as const) {
            for (const size of SIZES) {
                const tokens = tokensOf(buttonSurfaceClass(variant, size));

                expect(tokens, `${variant} ${size}`).toContain('shrink-0');
                expect(tokens, `${variant} ${size}`).toContain('max-w-full');
            }
        }

        expect(tokensOf(buttonSurfaceClass('destructive', 'md', 'confirm'))).toContain('shrink-0');
    });

    /**
     * F15 (`evaluateFinal.md`): a ghost text button that starts a line in a column (the eyebrow back link, Version
     * history) drew its box at the column edge, so its LABEL started 12-20 px inside the edge its siblings share. The edge
     * class pulls the box out by exactly the inline padding, read from the surface itself so the two cannot drift.
     */
    it('pulls a ghost button out by exactly its own inline padding, at every breakpoint', () => {
        const paddings = tokensOf(buttonSurfaceClass('ghost', 'sm')).filter((token) => /(?:^|:)px-\d+$/u.test(token));

        expect(paddings.length).toBeGreaterThan(0);
        expect([...tokensOf(GHOST_EDGE_CLASS)].sort()).toEqual(
            paddings.map((token) => token.replace(/px-(\d+)$/u, '-ms-$1')).sort(),
        );
    });

    it('sets the label in the label type role', () => {
        for (const { name, className } of SURFACES) {
            expect(tokensOf(className), name).toContain('text-label');
        }
    });
});

describe('buttonSurfaceClass — the state matrix (§1.10)', () => {
    // REWRITTEN in slice 2 (owner: primary buttons are ONE flat fill, `modernizeB.md` §3): the seafoam → ocean-dark
    // gradient is gone. The fill is the `action` role, the label `onAction`, and press/hover `actionPressed`.
    it('paints primary as ONE flat action fill with an onAction label, actionPressed on hover and press', () => {
        const tokens = tokensOf(buttonSurfaceClass('primary'));

        expect(tokens).toEqual(expect.arrayContaining(['bg-action', 'text-on-action']));
        expect(tokens).toEqual(expect.arrayContaining(['hover:bg-action-pressed', 'active:bg-action-pressed']));
        expect(tokens.filter((token) => /(?:^|:)(?:from|via|to|bg-gradient)-/u.test(token))).toEqual([]);
    });

    // Hover and press are an `ink` wash at 6% (`darkTheme.md` §1, "Pressed and hover"), which re-themes with `ink`;
    // the `pearl` fill it replaces is a light-only palette entry.
    it('paints secondary neutral: paper, a lineControl edge and an ink label, an ink wash on hover and press', () => {
        const tokens = tokensOf(buttonSurfaceClass('secondary'));

        expect(tokens).toEqual(expect.arrayContaining(['bg-paper', 'border', 'border-line-control', 'text-ink']));
        expect(tokens).toEqual(expect.arrayContaining(['hover:bg-ink/6', 'active:bg-ink/6']));
    });

    it('paints ghost as an actionText label with no fill and no edge, an ink wash on hover and press', () => {
        const tokens = tokensOf(buttonSurfaceClass('ghost'));

        expect(tokens).toContain('text-action-text');
        expect(tokens.filter((token) => /^(bg|border|from)-/u.test(token))).toEqual([]);
        expect(tokens).toEqual(expect.arrayContaining(['hover:bg-ink/6', 'active:bg-ink/6']));
    });

    it('paints inline destructive as a danger label on the neutral surface', () => {
        const tokens = tokensOf(buttonSurfaceClass('destructive'));

        expect(tokens).toEqual(expect.arrayContaining(['bg-paper', 'border-line-control', 'text-danger-text']));
    });

    it('fills destructive with error only in its confirm tone', () => {
        // `dangerText` is light in the dark theme, so it cannot be a pressed FILL: the press darkens the fill itself.
        expect(tokensOf(buttonSurfaceClass('destructive', 'md', 'confirm'))).toEqual(
            expect.arrayContaining(['bg-danger', 'text-on-action', 'hover:bg-danger/90', 'active:bg-danger/90']),
        );
        expect(tokensOf(buttonSurfaceClass('destructive'))).not.toContain('bg-danger');
    });

    // D15: every colour a tier paints is a ROLE, so the surface re-themes through the dark block.
    it('takes every colour from a role, in every tier and state', () => {
        const roleNames = new Set(Object.keys(role).map(kebab));
        const colourUtility = /^(?:bg|text|border|ring|from|via|to)-([a-z][a-z-]*?)(?:\/\d+)?$/u;

        for (const { name, className } of SURFACES) {
            const colours = tokensOf(className)
                .map((token) => colourUtility.exec(token.split(':').at(-1) ?? '')?.[1])
                .filter((colour): colour is string => colour !== undefined && !/^(?:label|\d|offset)/u.test(colour));

            expect(
                colours.filter((colour) => !roleNames.has(colour)),
                name,
            ).toEqual([]);
        }
    });

    it('lets coral into no control, at rest or on hover (owner: "Coral leaves every control")', () => {
        for (const { name, className } of SURFACES) {
            expect(className, name).not.toMatch(/coral/u);
        }
    });

    it('gives every tier a different surface', () => {
        expect(new Set(SURFACES.map(({ className }) => className)).size).toBe(SURFACES.length);
    });

    it('labels every tier at 4.5:1 or better on its own fill', () => {
        for (const { name, className } of SURFACES) {
            expect(wcagContrast(restingColour(className, 'text'), fillOf(className)), name).toBeGreaterThanOrEqual(
                AA_TEXT,
            );
        }
    });

    it('edges the outlined tiers at 3:1 or better against paper and the canvas (SC 1.4.11)', () => {
        for (const [variant, className] of [
            ['secondary', buttonSurfaceClass('secondary')],
            ['destructive', buttonSurfaceClass('destructive')],
        ] as const) {
            const edge = restingColour(className, 'border');

            expect(wcagContrast(edge, role.paper), variant).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
            expect(wcagContrast(edge, role.canvas), variant).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
        }
    });

    it('draws the focusRing role, two px wide and two px off, at 3:1 or better on every surface a button sits on', () => {
        for (const { name, className } of SURFACES) {
            expect(ringColour(className), name).toBe(role.focusRing);
            expect(tokensOf(className), name).toEqual(
                expect.arrayContaining(['focus-visible:ring-2', 'focus-visible:ring-offset-2']),
            );

            for (const backdrop of [role.paper, role.canvas, palette.pearl]) {
                expect(wcagContrast(ringColour(className), backdrop), name).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
            }
        }
    });

    it('dims a disabled control to 40%', () => {
        for (const { name, className } of SURFACES) {
            expect(tokensOf(className), name).toContain('disabled:opacity-40');
        }
    });

    it('carries the busy treatment, since a busy button stays focusable rather than natively disabled', () => {
        for (const { name, className } of SURFACES) {
            expect(className, name).toContain(BUSY_CONTROL_CLASS);
        }
    });
});

describe('buttonSurfaceClass — defaults', () => {
    it('defaults to the primary tier at md', () => {
        expect(buttonSurfaceClass()).toBe(buttonSurfaceClass('primary', 'md'));
    });

    it('defaults destructive to its inline tone', () => {
        expect(buttonSurfaceClass('destructive')).toBe(buttonSurfaceClass('destructive', 'md', 'inline'));
    });
});
