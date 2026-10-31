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
 * and leading of the line it sits in.
 *
 * @pattern Variant — a closed `typeRole` union rendered through Tamagui `variants`, which is the discriminated-union
 *     render map, so no `switch` is written
 * @pattern Adapter over the type scale (`nativeTokens.type`)
 */
import { styled, Text as TamaguiText } from 'tamagui';

import { nativeTokens } from '../tokens/native.js';
import type { TypeRole } from '../tokens/typography.js';

const { type } = nativeTokens;

/**
 * The most a role's text grows with the system's text-size setting. `0` means no cap (React Native). It is set here
 * and nowhere else, so the owner's open decision (a cap at 2×, WCAG 1.4.4's 200 %, is the recommendation) is a
 * one-line change.
 */
export const FONT_SCALE_CAP = 0;

export const Text = styled(TamaguiText, {
    name: 'CommiseText',
    maxFontSizeMultiplier: FONT_SCALE_CAP,

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
    } as const,

    defaultVariants: {
        typeRole: 'body',
    },
});
