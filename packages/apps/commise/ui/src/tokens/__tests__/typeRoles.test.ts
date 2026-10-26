/**
 * The type roles (`docs/design/uiOverhaul/buildSpec.md` §1.5). A screen names a role, never a size, so the table is
 * the contract: the source table, its web projection (`--text-{role}` with its line-height and weight sub-properties)
 * and its native projection (a registered face per weight, a pixel leading, never a `fontWeight`).
 *
 * The compiled half — that Tailwind turns those custom properties into working utilities — is proved by
 * `web/tests/__integration__/tailwindTheme.integration.test.ts`, which runs the real compiler. This file proves the
 * numbers.
 *
 * Mutation lens: change a size, weight or leading in the table and the table row fails; set a number in Playfair and the
 * "never sets a number" row fails; let a native role carry `fontWeight` and the native row fails; flatten the large
 * title's clamp to a `vw` or a fixed size and the clamp rows fail.
 */
import { describe, expect, it } from 'vitest';

import { containerThreshold } from '../layout.js';
import { nativeTokens } from '../native.js';
import { bodyFontFace, displayFontFace } from '../scale.js';
import { fontSizes, typeRole, webTypeRoles } from '../typography.js';

describe('typeRole — the §1.5 table', () => {
    // REWRITTEN for the owner's type-scale rulings (2026-10-25, 2026-10-26): sizes are 14, 16, 18 and 28 only, a leading
    // is whole px on a 4 px grid (it was a ratio), and the overline role is retired. `typeScale.test.ts` holds the rule;
    // this row holds the committed values (`typeScaleSpec` §2).
    it('states every role at its specified face, size, weight and px leading', () => {
        expect(typeRole).toEqual({
            largeTitle: {
                face: 'display',
                size: { narrow: 28, regular: 28, wide: 28 },
                weight: 'semibold',
                lineHeight: 32,
            },
            barTitle: { face: 'body', size: 16, weight: 'semibold', lineHeight: 20 },
            sectionTitle: { face: 'body', size: 18, weight: 'semibold', lineHeight: 24 },
            cardTitle: { face: 'body', size: 16, weight: 'semibold', lineHeight: 20 },
            body: { face: 'body', size: 16, weight: 'normal', lineHeight: 24 },
            readingBody: { face: 'body', size: 18, weight: 'normal', lineHeight: 28 },
            meta: { face: 'body', size: 14, weight: 'normal', lineHeight: 20 },
            list: { face: 'body', size: 14, weight: 'normal', lineHeight: 20 },
            label: { face: 'body', size: 14, weight: 'semibold', lineHeight: 20 },
            caption: { face: 'body', size: 14, weight: 'medium', lineHeight: 20 },
            figureInline: { face: 'body', size: 'inherit', weight: 'semibold', lineHeight: 'inherit', figure: true },
            figureStat: { face: 'body', size: 18, weight: 'semibold', lineHeight: 24, figure: true },
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
    // REWRITTEN for the px model: web writes the leading as the unitless `calc(px / size)`, so it still inherits and a
    // reader's 1.5x text-spacing override (WCAG 1.4.12) still wins.
    it('emits each fixed-size role in rem with its leading as calc(px / size) and its weight', () => {
        expect(webTypeRoles['card-title']).toEqual({ size: '1rem', lineHeight: 'calc(20 / 16)', fontWeight: '600' });
        expect(webTypeRoles['reading-body']).toEqual({
            size: '1.125rem',
            lineHeight: 'calc(28 / 18)',
            fontWeight: '400',
        });
        expect(webTypeRoles['figure-stat']).toEqual({
            size: '1.125rem',
            lineHeight: 'calc(24 / 18)',
            fontWeight: '600',
        });
    });

    it('emits the list role at 14 px (0.875rem), leading 20 px, weight 400', () => {
        expect(webTypeRoles.list).toEqual({ size: '0.875rem', lineHeight: 'calc(20 / 14)', fontWeight: '400' });
    });

    it('has no overline and no letter-spacing on any role', () => {
        expect(webTypeRoles).not.toHaveProperty('overline');

        for (const web of Object.values(webTypeRoles)) {
            expect(web).not.toHaveProperty('letterSpacing');
        }
    });

    // A role with no size of its own has nothing to put in `--text-*`; on web it is Tailwind's own `tabular-nums
    // lining-nums` on whatever line it sits in.
    it('emits no text token for the inline figure, which takes the size of its line', () => {
        expect(webTypeRoles).not.toHaveProperty('figure-inline');
    });

    // `caption` shares its `--text-*` name with the older ramp, so `themeCss` declares its size
    // once (the ramp's) and adds only the sub-properties. That is correct only while the two sizes agree.
    it('agrees with the ramp on the size of every role that shares a ramp name', () => {
        const ramp: Readonly<Record<string, string>> = fontSizes;
        const shared = Object.keys(webTypeRoles).filter((name) => name in ramp);

        expect(shared.sort()).toEqual(['caption']);

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
                'list',
                'label',
                'caption',
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

        it('never renders above 28 px at any container width (owner rule C1)', () => {
            for (const px of [0, 320, containerThreshold.regular, containerThreshold.wide, 4000]) {
                expect(evaluate(px)).toBeCloseTo(28, 5);
            }
        });

        it('carries the large title’s leading and a weight within the 600 ceiling', () => {
            expect(webTypeRoles['large-title']).toMatchObject({ lineHeight: 'calc(32 / 28)', fontWeight: '600' });
        });
    });
});

describe('nativeTokens.type — a face per weight, a pixel leading', () => {
    it('selects the registered face for each role’s family and weight', () => {
        expect(nativeTokens.type.body.fontFamily).toBe(bodyFontFace.normal);
        expect(nativeTokens.type.cardTitle.fontFamily).toBe(bodyFontFace.semibold);
        expect(nativeTokens.type.caption.fontFamily).toBe(bodyFontFace.medium);
        expect(nativeTokens.type.largeTitle.narrow.fontFamily).toBe(displayFontFace.semibold);
    });

    // REWRITTEN for the px model (2026-10-25): the leading is 20 px as stated, no longer 14 x 1.4 = 19.6.
    it('sets the list role in the regular body face at 14, with a 20 px leading', () => {
        expect(nativeTokens.type.list).toEqual({ fontFamily: bodyFontFace.normal, fontSize: 14, lineHeight: 20 });
    });

    it('gives the large title one size per container class', () => {
        expect(nativeTokens.type.largeTitle.narrow.fontSize).toBe(28);
        expect(nativeTokens.type.largeTitle.regular.fontSize).toBe(28);
        expect(nativeTokens.type.largeTitle.wide.fontSize).toBe(28);
    });

    it('uses each role’s px leading as stated, with no ratio math', () => {
        expect(nativeTokens.type.body.lineHeight).toBe(24);
        expect(nativeTokens.type.cardTitle.lineHeight).toBe(20);
        expect(nativeTokens.type.largeTitle.wide.lineHeight).toBe(32);
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
});
