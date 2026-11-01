/**
 * @module liveRegion/LiveRegionText — the text of a LiveRegion that names a type role: the design-system Text, with a
 * colour `tone` and an `offFlow` state for a region that is empty or only spoken. It stays MOUNTED (Android's live
 * region must exist before its text changes) but leaves the layout flow, by the one visually-hidden geometry.
 * Presentational: props in, text out, no state.
 *
 * @pattern Variant — the tone and the off-flow state are Tamagui variants, so every colour is a literal token the
 *     colour guard reads, and no style object is built at render
 */
import { styled } from 'tamagui';

import { Text } from '../text/Text.native.js';
import type { LiveRegionTone } from './props.js';

export const LiveRegionText = styled(Text, {
    variants: {
        tone: {
            ink: { color: '$ink' },
            inkMuted: { color: '$inkMuted' },
            dangerText: { color: '$dangerText' },
        } satisfies Record<LiveRegionTone, { readonly color: string }>,
        // `VISUALLY_HIDDEN_GEOMETRY` restated as a literal, because the style guards read only literal style objects.
        // `LiveRegion.native.test.tsx` fails if the two differ.
        offFlow: {
            true: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
        },
    } as const,

    defaultVariants: { tone: 'ink' },
});
