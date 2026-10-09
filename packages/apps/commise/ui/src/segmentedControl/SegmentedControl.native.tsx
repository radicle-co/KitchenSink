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
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import type { IconName } from '../icon/props.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { SegmentedControlProps } from './props.js';

/** The track's height: 44 pt on iOS, 48 dp on Android (spec §1.6). */
const trackHeight = (): number => (Platform.OS === 'android' ? 48 : 44);

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
    const { colors } = useTheme();
    const roles = ROLES[props.form];
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

    return (
        <View
            collapsable={false}
            role={roles.track}
            aria-label={props.label}
            style={[styles.track, { minHeight: trackHeight(), backgroundColor: colors.surfaceMuted }]}
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
                    style={[
                        styles.segment,
                        face.selected ? [styles.selected, { backgroundColor: colors.paper }] : null,
                    ]}
                >
                    {face.icon === undefined ? null : (
                        <Icon name={face.icon} size={20} tone={face.selected ? 'ink' : 'inkMuted'} />
                    )}
                    {props.form === 'view' && props.labelVisibility === 'hidden' ? null : (
                        <Text style={[styles.label, { color: face.selected ? colors.ink : colors.inkMuted }]}>
                            {face.label}
                        </Text>
                    )}
                </Pressable>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    track: {
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: nativeTokens.spacing[1],
        padding: nativeTokens.spacing[1],
        borderRadius: 999,
    },
    segment: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[2],
        borderRadius: 999,
        paddingHorizontal: nativeTokens.spacing[3],
    },
    selected: nativeTokens.elevation.sm,
    label: nativeTokens.type.label,
});
