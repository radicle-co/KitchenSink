/**
 * @module @commise/ui/text — the design system's native text (ADR-0080, slice 1). Native-only: web sets type with
 * Tailwind's role utilities, so this export has no web sibling (the `./modal` export is the precedent).
 *
 * A presentational primitive: props in, text out, no state. A screen names a TYPE ROLE and nothing else: `typeRole`
 * picks the registered face, the size and the leading together (`nativeTokens.type`, projected from `typography.ts`),
 * so no caller sets a font size, a face, a weight or a leading by hand (guard G4). Each leading is a `px` string, because Tamagui 3 reads a bare number as a ratio of the font size.
 * No role sets `fontWeight`: the face IS the weight on native, and both together render a synthesised bold.
 *
 * `largeTitle` has one style per container class, and all three are equal today; a test pins that, so the day they
 * differ this component reads the container class. `figureInline` sets only its face and figures, and takes the size
 * and leading of the line it sits in. ⚠️ It also carries the base `$ink`, so inside an `inkMuted` line it would draw
 * ink: no caller nests one yet, and the first that does adds a nested-colour test or names the line's colour.
 *
 * @pattern Variant — a closed `typeRole` union rendered through Tamagui `variants`, which is the discriminated-union
 *     render map, so no `switch` is written
 * @pattern Adapter over the type scale (`nativeTokens.type`)
 */
import { styled, Text as TamaguiText } from 'tamagui';

import { nativeTokens } from '../tokens/native.js';
import { FONT_SCALE_CAP } from './fontScaleCap.js';
import type { TypeRole } from '../tokens/typography.js';

const { type } = nativeTokens;

export const Text = styled(TamaguiText, {
    name: 'CommiseText',
    maxFontSizeMultiplier: FONT_SCALE_CAP,
    // Tamagui's Text defaults to `$color`, which no design-system theme defines; a device then logs a warning per text.
    color: '$ink',
    // Android pads a line with the font's own ascent and descent even under a fixed leading; a browser does not.
    includeFontPadding: false,

    variants: {
        typeRole: {
            largeTitle: {
                fontFamily: type.largeTitle.regular.fontFamily,
                fontSize: type.largeTitle.regular.fontSize,
                lineHeight: `${type.largeTitle.regular.lineHeight}px`,
            },
            barTitle: {
                fontFamily: type.barTitle.fontFamily,
                fontSize: type.barTitle.fontSize,
                lineHeight: `${type.barTitle.lineHeight}px`,
            },
            sectionTitle: {
                fontFamily: type.sectionTitle.fontFamily,
                fontSize: type.sectionTitle.fontSize,
                lineHeight: `${type.sectionTitle.lineHeight}px`,
            },
            cardTitle: {
                fontFamily: type.cardTitle.fontFamily,
                fontSize: type.cardTitle.fontSize,
                lineHeight: `${type.cardTitle.lineHeight}px`,
            },
            body: {
                fontFamily: type.body.fontFamily,
                fontSize: type.body.fontSize,
                lineHeight: `${type.body.lineHeight}px`,
            },
            readingBody: {
                fontFamily: type.readingBody.fontFamily,
                fontSize: type.readingBody.fontSize,
                lineHeight: `${type.readingBody.lineHeight}px`,
            },
            meta: {
                fontFamily: type.meta.fontFamily,
                fontSize: type.meta.fontSize,
                lineHeight: `${type.meta.lineHeight}px`,
            },
            list: {
                fontFamily: type.list.fontFamily,
                fontSize: type.list.fontSize,
                lineHeight: `${type.list.lineHeight}px`,
            },
            label: {
                fontFamily: type.label.fontFamily,
                fontSize: type.label.fontSize,
                lineHeight: `${type.label.lineHeight}px`,
            },
            caption: {
                fontFamily: type.caption.fontFamily,
                fontSize: type.caption.fontSize,
                lineHeight: `${type.caption.lineHeight}px`,
            },
            figureInline: {
                fontFamily: type.figureInline.fontFamily,
                fontVariant: ['tabular-nums', 'lining-nums'],
            },
            figureStat: {
                fontFamily: type.figureStat.fontFamily,
                fontSize: type.figureStat.fontSize,
                lineHeight: `${type.figureStat.lineHeight}px`,
                fontVariant: ['tabular-nums', 'lining-nums'],
            },
            // Every type role, and only those: a role added to the scale is a type error here until it is styled.
        } as const satisfies Record<TypeRole, object>,
        // Tabular, lining digits in the role's own face, so a figure in a line keeps that line's weight (a rating in
        // regular meta). `figureInline` is the role for a figure the copy stresses.
        figures: {
            true: { fontVariant: ['tabular-nums', 'lining-nums'] },
        },
    } as const,

    defaultVariants: {
        typeRole: 'body',
    },
});
