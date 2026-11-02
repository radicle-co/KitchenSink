/**
 * @module @commise/ui/segmented-control/geometry — the native segmented control's spacing, and the room it leaves a
 * label. The control's styles read these values, and the per-locale fit test reads {@link segmentLabelRoom} to prove
 * that no label breaks inside a word at the chrome cap (designer ruling 2026-11-01, ADR-0080 §8). Pure.
 *
 * @pattern Specification — one pure rule for a segment's label room, read by the control and by the fit test
 */
import type { ChromeCap } from '../text/scaledType.js';
import { spacing } from '../tokens/scale.js';
import type { TypeRole } from '../tokens/typography.js';

/** The role a segment's label is drawn in. */
export const SEGMENT_LABEL_ROLE = 'label' satisfies TypeRole;

/** The chrome cap a segment's label grows to: navigation chrome, so 1.5× (ADR-0080 §8). */
export const SEGMENT_CHROME_CAP = '1.5' satisfies ChromeCap;

/** The track's padding on every side, in dp. */
export const TRACK_INSET = spacing[1];

/** The gap between two segments, in dp. */
export const SEGMENT_GAP = spacing[1];

/** A segment's padding on each side of its content, in dp. */
export const SEGMENT_PADDING_X = spacing[3];

/** A segment's edge, transparent until it is selected, in dp. */
export const SEGMENT_EDGE = 1;

/** A segment icon's size, in dp. */
export const SEGMENT_ICON = 20;

/** The gap between a segment's icon and its label, in dp. */
export const SEGMENT_ICON_GAP = spacing[2];

/** What {@link segmentLabelRoom} reads. */
export interface SegmentLabelRoomInput {
    /** The track's width, in dp. */
    readonly trackWidth: number;
    /** How many segments share it. */
    readonly count: number;
    /** Whether each segment draws an icon before its label. */
    readonly withIcon: boolean;
}

/**
 * The width a label has inside one of `count` segments that share a track equally. Pure.
 *
 * @param input - The track's width, the number of segments, and whether they draw icons.
 * @returns The label's room, in dp.
 * @throws Error when there are no segments.
 */
export function segmentLabelRoom({ trackWidth, count, withIcon }: SegmentLabelRoomInput): number {
    if (count < 1) {
        throw new Error('A segmented control has at least one segment.');
    }

    const segment = (trackWidth - 2 * TRACK_INSET - (count - 1) * SEGMENT_GAP) / count;
    const icon = withIcon ? SEGMENT_ICON + SEGMENT_ICON_GAP : 0;

    return segment - 2 * SEGMENT_PADDING_X - 2 * SEGMENT_EDGE - icon;
}
