/**
 * @module @commise/ui/chip — the native design-system {@link Chip}.
 *
 * A `filter` chip is a `checkbox` (`aria-checked`), with a 16 pt check before its label while selected and an optional
 * `figure` count after it; an `input` chip is a button named by the caller's remove label, with a trailing `x`. Each is
 * a 32 pt pill inside a 44 pt hit area (48 dp on Android). The accessible name is always stated, because
 * react-native-web joins a pressable's texts without a space and a truncated label must still be named in full.
 *
 * @pattern Visitor — an exhaustive switch over the `kind` discriminated union; the geometry is `chipStyle.ts`
 */
import type { FC } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useSurfaceTone } from '../surfaceTone/surfaceToneContext.js';
import { Text } from '../text/Text.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { visibleChipLabel } from './chipLabel.js';
import { CHIP_LABEL_LINES, chipHit, chipHitHeight, chipPill } from './chipStyle.js';
import type { ChipProps } from './props.js';

/** The native design-system chip. */
export const Chip: FC<ChipProps> = (props) => {
    const theme = useTheme();
    const tone = useSurfaceTone();

    switch (props.kind) {
        case 'filter':
            return (
                <Pressable
                    role="checkbox"
                    aria-checked={props.selected}
                    aria-label={props.count === undefined ? props.label : `${props.label} ${String(props.count)}`}
                    onPress={props.onPress}
                    style={[chipHit, { minHeight: chipHitHeight() }]}
                >
                    {({ pressed }) => (
                        <View style={chipPill(theme, props.selected, pressed, tone)}>
                            {props.selected ? <Icon name="check" size={16} tone="actionText" /> : null}
                            {/* The design-system Text, so the label and the count stop at 2x and wrap at word boundaries
                                (designer finding C-1, reviews/mergedUiIos1.md); the pill grows with them (a minimum height). */}
                            <Text
                                typeRole="caption"
                                color={props.selected ? '$actionText' : '$ink'}
                                flexShrink={1}
                                numberOfLines={CHIP_LABEL_LINES}
                            >
                                {visibleChipLabel(props.label)}
                            </Text>
                            {props.count === undefined ? null : (
                                <Text typeRole="label" figures color="$inkMuted">
                                    {props.count}
                                </Text>
                            )}
                        </View>
                    )}
                </Pressable>
            );
        case 'input':
            return (
                <Pressable
                    role="button"
                    aria-label={props.removeLabel}
                    onPress={props.onRemove}
                    style={[chipHit, { minHeight: chipHitHeight() }]}
                >
                    {({ pressed }) => (
                        <View style={chipPill(theme, false, pressed, tone)}>
                            <Text typeRole="caption" color="$ink" flexShrink={1} numberOfLines={CHIP_LABEL_LINES}>
                                {visibleChipLabel(props.label)}
                            </Text>
                            <Icon name="x" size={16} />
                        </View>
                    )}
                </Pressable>
            );
    }
};
