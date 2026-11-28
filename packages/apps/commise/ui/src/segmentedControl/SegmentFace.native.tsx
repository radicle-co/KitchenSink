/**
 * @module @commise/ui/segmented-control — the face of one native segment: the `Elevated` that carries the
 * segment's fill and edge.
 *
 * Presentational: props → JSX. Styled with Tamagui only (ADR-0080), in a file of its own because a module that imports
 * Tamagui holds no React Native `StyleSheet`.
 */
import { styled } from 'tamagui';

import { Elevated } from '../elevation/Elevated.native.js';
import { nativeTokens } from '../tokens/native.js';
import { SEGMENT_EDGE, SEGMENT_ICON_GAP, SEGMENT_PADDING_X } from './nativeSegmentGeometry.js';

/**
 * The segment's face: an `Elevated` that carries its own fill, as `Elevated` prescribes, so the count of React Native
 * `style` uses does not grow. A transparent 1 pt edge sits on every segment; the selected one colours it `lineControl`
 * (`componentFixes.md` §8), so selecting moves nothing and paper on the muted track keeps a 3:1 boundary. The lift
 * (`level`) is passed by the caller only for the selected segment.
 *
 * @pattern Variant — the `selected` boolean picks the fill and the edge through Tamagui `variants`
 */
export const SegmentFace = styled(Elevated, {
    name: 'SegmentFace',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SEGMENT_ICON_GAP,
    borderRadius: nativeTokens.radius.full,
    borderWidth: SEGMENT_EDGE,
    paddingHorizontal: SEGMENT_PADDING_X,

    variants: {
        selected: {
            true: { backgroundColor: '$paper', borderColor: '$lineControl' },
            false: { borderColor: 'transparent' },
        },
    } as const,
});
