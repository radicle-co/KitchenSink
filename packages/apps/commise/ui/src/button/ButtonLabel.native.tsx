/**
 * @module button/ButtonLabel — the native Button's label: the design-system Text in the `cardTitle` role, coloured by its
 * surface (ADR-0080 §8). Each surface's colour is a literal theme token in a variant table, so the colour guard reads
 * every one (`colourRoles`). Native only; the web Button colours its label with classes. Presentational: props in, text
 * out, no state.
 *
 * @pattern Variant — a closed `surface` union rendered through Tamagui `variants`, which is the render map
 */
import { styled } from 'tamagui';

import { Text } from '../text/Text.native.js';
import type { Role } from '../tokens/colors.js';
import type { ButtonSurface } from './surfacePaint.native.js';

/** The label, in the `cardTitle` role, coloured by its surface. */
export const ButtonLabel = styled(Text, {
    typeRole: 'cardTitle',

    variants: {
        surface: {
            primary: { color: '$onAction' },
            secondary: { color: '$ink' },
            ghost: { color: '$actionText' },
            quiet: { color: '$ink' },
            destructiveInline: { color: '$dangerText' },
            destructiveConfirm: { color: '$onAction' },
        } satisfies Record<ButtonSurface, { readonly color: `$${Role}` }>,
    } as const,
});
