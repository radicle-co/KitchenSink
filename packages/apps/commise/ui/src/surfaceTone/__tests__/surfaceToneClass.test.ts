/**
 * The web paint of the surface-tone table. Tailwind scans SOURCE for literal class names, so `surfaceToneClass.ts`
 * spells each tone's classes out. Spelling is a second representation of the table, so these tests parse the literals
 * back into roles and require them to EQUAL the table: a tone whose literal drifts from its row fails by name.
 *
 * Mutation lens: change one tone's `--cm-press` to another tone's role, drop a tone, or give the fallback a different
 * role than the canvas row, and a test below fails.
 */
import { describe, expect, it } from 'vitest';

import { kebab } from '../../tokens/emit.js';
import { role, roleDark, type Role } from '../../tokens/colors.js';
import { themeCss } from '../../tokens/themeCss.js';
import {
    CHIP_FILL_VAR,
    CHIP_PRESS_VAR,
    chipFillRoleOf,
    chipFillVarOf,
    chipPressToneOf,
    chipPressVarOf,
    PRESS_VAR,
    pressFillsOf,
    pressVarOf,
    SURFACE_TONES,
    SURFACE_TONE_NAMES,
    SURFACE_VAR,
    type SurfaceTone,
} from '../surfaceTone.js';
import { CHIP_REST_FILL_CLASS, PRESS_FILL_CLASS, SURFACE_TONE_CLASS, surfaceToneClass } from '../surfaceToneClass.js';

/** The role a `var(--color-<kebab>)` reads, from its kebab name. */
function roleOfVar(declaration: string): Role {
    const name = /var\(--color-([a-z-]+)\)/u.exec(declaration)?.[1];
    const roles = new Set<Role>(Object.values(SURFACE_TONES).map((row) => row.fill));
    const found = [...roles].find((candidate) => kebab(candidate) === name);

    if (found === undefined) {
        throw new Error(`No surface role is emitted as --color-${name ?? '?'} (${declaration}).`);
    }

    return found;
}

/** The property a `var(--color-press-<tone>)` reads: the press custom property of a tone. */
function pressToneOfVar(declaration: string): SurfaceTone {
    const tone = SURFACE_TONE_NAMES.find((name) => declaration === `var(${pressVarOf(name)})`);

    if (tone === undefined) {
        throw new Error(`${declaration} is not a tone's press property.`);
    }

    return tone;
}

/** The value a class sets a custom property to: `[--cm-press:var(--color-press-muted)]` -> `var(--color-press-muted)`. */
function propertyOf(classes: string, property: string): string {
    const match = new RegExp(`\\[${property}:([^\\]]+)\\]`, 'u').exec(classes);

    if (match?.[1] === undefined) {
        throw new Error(`"${classes}" does not set ${property}.`);
    }

    return match[1];
}

describe('SURFACE_TONE_CLASS', () => {
    it('has a literal class for every tone in the table, and no other', () => {
        expect(Object.keys(SURFACE_TONE_CLASS).sort()).toEqual([...SURFACE_TONE_NAMES].sort());
    });

    for (const name of SURFACE_TONE_NAMES) {
        const row = SURFACE_TONES[name];

        it(`${name}: paints its fill and sets the surface, press and chip properties to the table's roles`, () => {
            const classes = surfaceToneClass(name);

            expect(classes.split(/\s+/u)).toContain(`bg-${kebab(row.fill)}`);
            expect(roleOfVar(propertyOf(classes, SURFACE_VAR))).toBe(row.fill);
            expect(pressToneOfVar(propertyOf(classes, PRESS_VAR))).toBe(name);
            // The chip's fill is per theme, so the class names the tone's own property and the stylesheet resolves it.
            expect(propertyOf(classes, CHIP_FILL_VAR)).toBe(`var(${chipFillVarOf(name)})`);
            expect(propertyOf(classes, CHIP_PRESS_VAR)).toBe(`var(${chipPressVarOf(name)})`);
        });
    }

    it('sets all four properties on EVERY tone, so a nested surface never inherits its parent’s press', () => {
        for (const name of SURFACE_TONE_NAMES) {
            for (const property of [SURFACE_VAR, PRESS_VAR, CHIP_FILL_VAR, CHIP_PRESS_VAR]) {
                expect(() => propertyOf(surfaceToneClass(name), property), `${name} ${property}`).not.toThrow();
            }
        }
    });
});

describe('PRESS_FILL_CLASS', () => {
    const canvasPress = `var(${pressVarOf('canvas')})`;

    it('presses to the surface’s --cm-press, falling back to the canvas row outside every surface', () => {
        for (const variant of ['hover', 'active']) {
            expect(PRESS_FILL_CLASS.pointer).toContain(`${variant}:bg-(${PRESS_VAR},${canvasPress})`);
        }

        expect(PRESS_FILL_CLASS.highlighted).toBe(`data-[highlighted]:bg-(${PRESS_VAR},${canvasPress})`);
        expect(PRESS_FILL_CLASS.focused).toBe(`focus-visible:bg-(${PRESS_VAR},${canvasPress})`);
    });

    // A chip outside every surface reads the CANVAS row's chip vars, which `themeCss` emits in both themes. Naming the
    // vars (not a role) is what lets the dark theme resolve to its own fill; a role fallback was light-only.
    const emitted = (variable: string): string[] =>
        [...themeCss().matchAll(new RegExp(`${variable}: (#[0-9a-fA-F]{6});`, 'gu'))].map((match) => match[1] ?? '');

    it('has a chip variant that reads the chip’s own press property, falling back to the canvas chip press', () => {
        const fallback = `var(${chipPressVarOf('canvas')})`;

        expect(PRESS_FILL_CLASS.chip).toBe(
            `hover:bg-(${CHIP_PRESS_VAR},${fallback}) active:bg-(${CHIP_PRESS_VAR},${fallback})`,
        );
    });

    it('rests a chip on the surface’s chip fill, falling back to the canvas chip fill', () => {
        expect(CHIP_REST_FILL_CLASS).toBe(`bg-(${CHIP_FILL_VAR},var(${chipFillVarOf('canvas')}))`);
    });

    it.each(['light', 'dark'] as const)(
        'the canvas chip fallback resolves to the table’s role in the %s theme',
        (scheme) => {
            const colors = scheme === 'light' ? role : roleDark;

            expect(emitted(chipFillVarOf('canvas'))).toContain(colors[chipFillRoleOf('canvas', scheme)]);
            expect(emitted(chipPressVarOf('canvas'))).toContain(
                pressFillsOf(colors, scheme)[chipPressToneOf('canvas', scheme)],
            );
        },
    );
});
