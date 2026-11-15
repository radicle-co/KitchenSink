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
import { Platform } from 'react-native';
import { styled, Text as TamaguiText } from 'tamagui';

import { nativeTokens } from '../tokens/native.js';
import type { TypeRole } from '../tokens/typography.js';
import { scaledTypeMetrics, type ChromeCap } from './scaledType.js';
import { TextScaleContext } from './textScaleContext.native.js';

const { type } = nativeTokens;

const TextFrame = styled(TamaguiText, {
    name: 'CommiseText',
    context: TextScaleContext,
    // React Native 0.86 on Android caps a text's size but not its set line height (`TextAttributeProps.kt:42`), so system
    // scaling is off and `Text` below draws the size and leading itself (ADR-0080 §8).
    allowFontScaling: false,
    // Tamagui's Text defaults to `$color`, which no design-system theme defines; a device then logs a warning per text.
    color: '$ink',
    // Android pads a line with the font's own ascent and descent even under a fixed leading; a browser does not.
    includeFontPadding: false,

    variants: {
        typeRole: {
            largeTitle: {
                fontFamily: type.largeTitle.regular.fontFamily,
            },
            barTitle: {
                fontFamily: type.barTitle.fontFamily,
            },
            sectionTitle: {
                fontFamily: type.sectionTitle.fontFamily,
            },
            cardTitle: {
                fontFamily: type.cardTitle.fontFamily,
            },
            body: {
                fontFamily: type.body.fontFamily,
            },
            readingBody: {
                fontFamily: type.readingBody.fontFamily,
            },
            readingLarge: {
                fontFamily: type.readingLarge.fontFamily,
            },
            meta: {
                fontFamily: type.meta.fontFamily,
            },
            list: {
                fontFamily: type.list.fontFamily,
            },
            label: {
                fontFamily: type.label.fontFamily,
            },
            caption: {
                fontFamily: type.caption.fontFamily,
            },
            figureInline: {
                fontFamily: type.figureInline.fontFamily,
                fontVariant: ['tabular-nums', 'lining-nums'],
            },
            figureStat: {
                fontFamily: type.figureStat.fontFamily,
                fontVariant: ['tabular-nums', 'lining-nums'],
            },
            // Every type role, and only those: a role added to the scale is a type error here until it is styled.
        } as const satisfies Record<TypeRole, object>,
        // Tabular, lining digits in the role's own face, so a figure in a line keeps that line's weight (a rating in
        // regular meta). `figureInline` is the role for a figure the copy stresses.
        figures: {
            true: { fontVariant: ['tabular-nums', 'lining-nums'] },
        },
        // The system text scale, from TextScaleContext; `.resolve` below turns it into the role's size and leading.
        textScale: styled.dynamic<number>(),
        // Navigation chrome only (a guard admits it in the tab bar and the view-switch control): a step that can only
        // LOWER the role's ceiling, to 1.5×, 1.4× or 1.3× (`CHROME_CAPS`, ADR-0080 §8).
        chromeCap: {
            '1.5': {},
            '1.4': {},
            '1.3': {},
        } satisfies Record<ChromeCap, object>,
        // A mark drawn on a picture (a guard admits it in the status badge only): the role's own size at every scale.
        pictorial: {
            true: {},
        },
        // Initials in a disc (a guard admits it in the avatar disc and the discovery footer's avatar): a size in px that does
        // not scale, 40% of the disc's diameter (designer ruling 2026-11-03).
        fixedPx: styled.dynamic<number>(),
        // With `fixedPx` (admitted in the cover letter only): the capital is centred, not the line (`letterMetrics`).
        capCentred: {
            true: {},
        },
    } as const,

    defaultVariants: {
        typeRole: 'body',
    },
});

/**
 * What the resolver reads. Tamagui types a resolver's props loosely, so a misspelled key would compile and read
 * `undefined`; naming the two fields makes a typo a type error.
 */
interface ScaledTextProps {
    readonly typeRole?: TypeRole;
    readonly textScale?: number;
    readonly chromeCap?: ChromeCap;
    readonly pictorial?: boolean;
    readonly fixedPx?: number;
    readonly capCentred?: boolean;
}

/**
 * The design-system Text: the frame above, drawn at its role's size and leading for the system text scale, up to the
 * role's ceiling (`scaledTypeMetrics`, ADR-0080 §8). The scale comes from `TextScaleContext`, which `DesignSystemTheme`
 * provides. `figureInline` gets no size of its own and keeps its line's. A `styled(Text)` inherits the resolver.
 */
export const Text = TextFrame.resolve(
    ({ typeRole, textScale, chromeCap, pictorial, fixedPx, capCentred }: ScaledTextProps) =>
        scaledTypeMetrics(
            typeRole ?? 'body',
            textScale ?? 1,
            chromeCap,
            pictorial,
            fixedPx,
            capCentred,
            Platform.OS === 'ios' ? 'ios' : 'other',
        ),
);
