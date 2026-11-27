/**
 * @module @commise/ui/segmented-control — the native design-system {@link SegmentedControl}.
 *
 * A `route` control is a `tablist` of `tab`s with `aria-selected`; a `view` control a `radiogroup` of `radio`s with
 * `aria-checked`. Both share one look: a `pearl` track 44 pt tall (48 dp on Android), segments sharing it equally, the
 * selected one `paper` with an `ink` label and the others `inkMuted`.
 *
 * @pattern Visitor — the `form` discriminated union picks the roles; the look is shared
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import { Elevated } from '../elevation/Elevated.native.js';
import { Icon } from '../icon/Icon.native.js';
import type { IconName, IconProps } from '../icon/props.js';
import { nativeTokens } from '../tokens/native.js';
import type { SegmentedControlProps } from './props.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { Surface } from '../surfaceTone/Surface.native.js';
import { Text } from '../text/Text.native.js';
import {
    SEGMENT_EDGE,
    SEGMENT_GAP,
    SEGMENT_ICON,
    SEGMENT_ICON_GAP,
    SEGMENT_CHROME_CAP,
    SEGMENT_LABEL_ROLE,
    SEGMENT_PADDING_X,
    TRACK_INSET,
} from './nativeSegmentGeometry.js';

/** Where an `adaptive` route control stops filling the row and takes its content's width, in dp (`containerThreshold.regular`). */
const ADAPTIVE_FROM = 600;

/** A content-width route segment's floor, in dp: two place names must not squeeze (W-25). */
const CONTENT_SEGMENT_MIN = 136;

/** A segment's vertical hit slop: the track's inset above and below it. */
const SEGMENT_HIT_SLOP = { top: TRACK_INSET, bottom: TRACK_INSET } as const;

/** One segment, with the roles its control's form gives it. */
interface SegmentFace {
    readonly id: string;
    readonly label: string;
    readonly icon?: IconName;
    readonly selected: boolean;
    readonly onPress: () => void;
}

/** The roles each form's track and segments take. */
const ROLES = {
    route: { track: 'tablist', segment: 'tab' },
    view: { track: 'radiogroup', segment: 'radio' },
} as const;

/** The native design-system segmented control. */
export const SegmentedControl: FC<SegmentedControlProps> = (props) => {
    const windowWidth = useWindowDimensions().width;
    const roles = ROLES[props.form];
    // Only a ROUTE control chooses its width (a view switch is sized by its glyphs on web and fills a row here).
    const routeWidth = props.form === 'route' ? (props.width ?? 'share') : 'share';
    const compactTrack = routeWidth === 'content' || (routeWidth === 'adaptive' && windowWidth >= ADAPTIVE_FROM);
    const faces: readonly SegmentFace[] =
        props.form === 'route'
            ? props.segments.map((segment) => ({
                  id: segment.id,
                  label: segment.label,
                  selected: segment.id === props.current,
                  onPress: () => props.onSelect(segment.id),
              }))
            : props.segments.map((segment) => ({
                  id: segment.id,
                  label: segment.label,
                  ...(segment.icon === undefined ? {} : { icon: segment.icon }),
                  selected: segment.id === props.value,
                  onPress: () => props.onChange(segment.id),
              }));

    // A view switch can hide its labels: its glyphs are then the only face, an icon-only control, which stays fixed.
    const labelHidden = props.form === 'view' && props.labelVisibility === 'hidden';
    const glyphScale: Pick<IconProps, 'scaleWith'> = labelHidden
        ? {}
        : { scaleWith: { role: SEGMENT_LABEL_ROLE, chromeCap: SEGMENT_CHROME_CAP } };

    return (
        <Surface
            tone="muted"
            role={roles.track}
            aria-label={props.label}
            style={[styles.track, compactTrack ? styles.trackContent : null, { minHeight: touchFloor() }]}
        >
            {faces.map((face) => (
                <Pressable
                    key={face.id}
                    role={roles.segment}
                    {...(props.form === 'route'
                        ? { 'aria-selected': face.selected }
                        : { 'aria-checked': face.selected })}
                    aria-label={face.label}
                    onPress={face.onPress}
                    // The track pads each segment by TRACK_INSET; the slop gives the target back that band, so it spans the track.
                    hitSlop={SEGMENT_HIT_SLOP}
                    style={[styles.slot, compactTrack ? styles.slotContent : null]}
                >
                    <Elevated
                        // The press owner is the Pressable above: a Tamagui press handler adds a second responder view.
                        // Only the selected segment is lifted: the unselected one carries no shadow field at all.
                        {...(face.selected ? { level: 'sm' as const } : {})}
                        {...segmentFace}
                        {...(face.selected
                            ? { backgroundColor: '$paper', borderColor: '$lineControl' }
                            : { borderColor: 'transparent' })}
                    >
                        {face.icon === undefined ? null : (
                            <Icon
                                name={face.icon}
                                size={SEGMENT_ICON}
                                tone={face.selected ? 'ink' : 'inkMuted'}
                                {...glyphScale}
                            />
                        )}
                        {labelHidden ? null : (
                            <Text
                                typeRole={SEGMENT_LABEL_ROLE}
                                chromeCap={SEGMENT_CHROME_CAP}
                                color={face.selected ? '$ink' : '$inkMuted'}
                            >
                                {face.label}
                            </Text>
                        )}
                    </Elevated>
                </Pressable>
            ))}
        </Surface>
    );
};

/**
 * The segment's face as Tamagui props, so the `Elevated` carries the fill and the count of React Native `style`
 * uses does not grow. A transparent 1 pt edge sits on every segment; the selected one colours it `lineControl`
 * (`componentFixes.md` §8), so selecting moves nothing and paper on the muted track keeps a 3:1 boundary.
 */
const segmentFace = {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SEGMENT_ICON_GAP,
    borderRadius: nativeTokens.radius.full,
    borderWidth: SEGMENT_EDGE,
    paddingHorizontal: SEGMENT_PADDING_X,
} as const;

const styles = StyleSheet.create({
    track: {
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: SEGMENT_GAP,
        padding: TRACK_INSET,
        borderRadius: nativeTokens.radius.full,
    },
    trackContent: { alignSelf: 'flex-start' },
    slot: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    slotContent: { flexGrow: 0, flexBasis: 'auto', minWidth: CONTENT_SEGMENT_MIN },
});
