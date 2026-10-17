/**
 * The type roles (`docs/design/uiOverhaul/buildSpec.md` §1.5). A screen names a role, never a size, so the table is
 * the contract: the source table, its web projection (`--text-{role}` with its line-height and weight sub-properties)
 * and its native projection (a registered face per weight, a pixel leading, never a `fontWeight`).
 *
 * The compiled half — that Tailwind turns those custom properties into working utilities — is proved by
 * `web/tests/__integration__/tailwindTheme.integration.test.ts`, which runs the real compiler. This file proves the
 * numbers.
 *
 * Mutation lens: change a size, weight or ratio in the table and the table row fails; set a number in Playfair and the
 * "never sets a number" row fails; let a native role carry `fontWeight` and the native row fails; flatten the large
 * title's clamp to a `vw` or a fixed size and the clamp rows fail.
 */
import { describe, expect, it } from 'vitest';

import { containerThreshold } from '../layout.js';
import { nativeTokens } from '../native.js';
import { bodyFontFace, displayFontFace } from '../scale.js';
import { fontSizes, typeRole, webTypeRoles } from '../typography.js';

describe('typeRole — the §1.5 table', () => {
    it('states every role at its specified face, size, weight and leading', () => {
        expect(typeRole).toEqual({
            largeTitle: {
                face: 'display',
                size: { narrow: 28, regular: 34, wide: 40 },
                weight: 'bold',
                lineHeight: 1.15,
            },
            barTitle: { face: 'body', size: 17, weight: 'semibold', lineHeight: 1.2 },
            sectionTitle: { face: 'body', size: 18, weight: 'semibold', lineHeight: 1.25 },
            cardTitle: { face: 'body', size: 16, weight: 'semibold', lineHeight: 1.3 },
            body: { face: 'body', size: 16, weight: 'normal', lineHeight: 1.5 },
            readingBody: { face: 'body', size: 18, weight: 'normal', lineHeight: 1.6 },
            meta: { face: 'body', size: 14, weight: 'normal', lineHeight: 1.4 },
            label: { face: 'body', size: 14, weight: 'semibold', lineHeight: 1.2 },
            caption: { face: 'body', size: 12, weight: 'medium', lineHeight: 1.4 },
            overline: {
                face: 'body',
                size: 11,
                weight: 'semibold',
                lineHeight: 1.4,
                letterSpacingEm: 0.06,
                uppercase: true,
            },
            figureInline: { face: 'body', size: 'inherit', weight: 'semibold', lineHeight: 'inherit', figure: true },
            figureStat: { face: 'body', size: 20, weight: 'semibold', lineHeight: 1.2, figure: true },
        });
    });

    // §1.5: "Playfair sets names only … It never sets a number."
    it('sets every figure in the body face, never Playfair', () => {
        for (const spec of Object.values(typeRole)) {
            if ('figure' in spec) {
                expect(spec.face).toBe('body');
            }
        }
    });

    // §1.5: "Inputs never go below 16 px, so iOS Safari does not zoom." The body role is what an input is set in.
    it('keeps the body role at 16 px or more', () => {
        expect(typeRole.body.size).toBeGreaterThanOrEqual(16);
    });

    it('gives every display role a weight the display family has a face for', () => {
        for (const spec of Object.values(typeRole)) {
            if (spec.face === 'display') {
                expect(Object.keys(displayFontFace)).toContain(spec.weight);
            }
        }
    });
});

describe('webTypeRoles — the --text-{role} projection', () => {
    it('emits each fixed-size role in rem with its leading and weight', () => {
        expect(webTypeRoles['card-title']).toEqual({ size: '1rem', lineHeight: '1.3', fontWeight: '600' });
        expect(webTypeRoles['reading-body']).toEqual({ size: '1.125rem', lineHeight: '1.6', fontWeight: '400' });
        expect(webTypeRoles['figure-stat']).toEqual({ size: '1.25rem', lineHeight: '1.2', fontWeight: '600' });
    });

    it('carries the overline’s tracking as a letter-spacing sub-property', () => {
        expect(webTypeRoles.overline).toEqual({
            size: '0.6875rem',
            lineHeight: '1.4',
            fontWeight: '600',
            letterSpacing: '0.06em',
        });
    });

    // A role with no size of its own has nothing to put in `--text-*`; on web it is Tailwind's own `tabular-nums
    // lining-nums` on whatever line it sits in.
    it('emits no text token for the inline figure, which takes the size of its line', () => {
        expect(webTypeRoles).not.toHaveProperty('figure-inline');
    });

    // `caption` and `overline` share their `--text-*` name with the older ramp, so `themeCss` declares their size
    // once (the ramp's) and adds only the sub-properties. That is correct only while the two sizes agree.
    it('agrees with the ramp on the size of every role that shares a ramp name', () => {
        const ramp: Readonly<Record<string, string>> = fontSizes;
        const shared = Object.keys(webTypeRoles).filter((name) => name in ramp);

        expect(shared.sort()).toEqual(['caption', 'overline']);

        for (const name of shared) {
            expect(webTypeRoles[name]?.size, name).toBe(ramp[name]);
        }
    });

    it('names every other role, kebab-cased', () => {
        expect(Object.keys(webTypeRoles).sort()).toEqual(
            [
                'large-title',
                'bar-title',
                'section-title',
                'card-title',
                'body',
                'reading-body',
                'meta',
                'label',
                'caption',
                'overline',
                'figure-stat',
            ].sort(),
        );
    });

    describe('the large title is a bounded clamp in container units', () => {
        const clamp = webTypeRoles['large-title'].size;

        /** Evaluate `clamp(MIN rem, A rem + B cqi, MAX rem)` at a container width, in px. */
        function evaluate(containerPx: number): number {
            const match = /^clamp\(([\d.]+)rem, ([\d.]+)rem \+ ([\d.]+)cqi, ([\d.]+)rem\)$/u.exec(clamp);

            expect(match, `unexpected clamp shape: ${clamp}`).not.toBeNull();

            const [min, base, slope, max] = (match ?? []).slice(1).map(Number) as [number, number, number, number];
            const preferred = base * 16 + (slope / 100) * containerPx;

            return Math.min(max * 16, Math.max(min * 16, preferred));
        }

        it('uses cqi, never vw', () => {
            expect(clamp).toContain('cqi');
            expect(clamp).not.toContain('vw');
        });

        it('floors at the narrow size and caps at the wide size', () => {
            expect(evaluate(0)).toBe(28);
            expect(evaluate(4000)).toBe(40);
        });

        it.each([
            ['regular', containerThreshold.regular, 34],
            ['wide', containerThreshold.wide, 40],
        ] as const)('reaches the %s size at the %s threshold', (_name, px, size) => {
            expect(evaluate(px)).toBeCloseTo(size, 1);
        });

        it('carries the large title’s leading and weight', () => {
            expect(webTypeRoles['large-title']).toMatchObject({ lineHeight: '1.15', fontWeight: '700' });
        });
    });
});

describe('nativeTokens.type — a face per weight, a pixel leading', () => {
    it('selects the registered face for each role’s family and weight', () => {
        expect(nativeTokens.type.body.fontFamily).toBe(bodyFontFace.normal);
        expect(nativeTokens.type.cardTitle.fontFamily).toBe(bodyFontFace.semibold);
        expect(nativeTokens.type.caption.fontFamily).toBe(bodyFontFace.medium);
        expect(nativeTokens.type.largeTitle.narrow.fontFamily).toBe(displayFontFace.bold);
    });

    it('gives the large title one size per container class', () => {
        expect(nativeTokens.type.largeTitle.narrow.fontSize).toBe(28);
        expect(nativeTokens.type.largeTitle.regular.fontSize).toBe(34);
        expect(nativeTokens.type.largeTitle.wide.fontSize).toBe(40);
    });

    it('turns each ratio into an absolute leading', () => {
        expect(nativeTokens.type.body.lineHeight).toBe(24);
        expect(nativeTokens.type.cardTitle.lineHeight).toBeCloseTo(20.8, 5);
        expect(nativeTokens.type.largeTitle.wide.lineHeight).toBeCloseTo(46, 5);
    });

    it('sets figures in tabular, lining digits', () => {
        expect(nativeTokens.type.figureStat.fontVariant).toEqual(['tabular-nums', 'lining-nums']);
        expect(nativeTokens.type.figureInline.fontVariant).toEqual(['tabular-nums', 'lining-nums']);
    });

    // React Native nests a figure inside the line it qualifies, and a nested Text inherits the size of its parent.
    it('leaves the inline figure’s size and leading to the line it sits in', () => {
        expect(nativeTokens.type.figureInline).not.toHaveProperty('fontSize');
        expect(nativeTokens.type.figureInline).not.toHaveProperty('lineHeight');
    });

    it('uppercases and tracks the overline in px', () => {
        expect(nativeTokens.type.overline.textTransform).toBe('uppercase');
        expect(nativeTokens.type.overline.letterSpacing).toBeCloseTo(0.66, 5);
    });
});
