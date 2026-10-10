/**
 * @module @commise/ui/chip — the native design-system {@link Chip}.
 *
 * A `filter` chip is a `checkbox` (`aria-checked`), with a 16 pt check before its label while selected and an optional
 * `figure` count after it; an `input` chip is a button named by the caller's remove label, with a trailing `x`. Each is
 * a 36 pt pill inside a 44 pt hit area (48 dp on Android). The accessible name is always stated, because
 * react-native-web joins a pressable's texts without a space and a truncated label must still be named in full.
 *
 * @pattern Visitor — an exhaustive switch over the `kind` discriminated union; the geometry is `chipStyle.ts`
 */
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { visibleChipLabel } from './chipLabel.js';
import { chipCount, chipHit, chipHitHeight, chipLabel, chipPill } from './chipStyle.js';
import type { ChipProps } from './props.js';

/** The native design-system chip. */
export const Chip: FC<ChipProps> = (props) => {
    const theme = useTheme();

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
                        <View style={chipPill(theme, props.selected, pressed)}>
                            {props.selected ? <Icon name="check" size={16} tone="actionText" /> : null}
                            <Text style={chipLabel(theme, props.selected)}>{visibleChipLabel(props.label)}</Text>
                            {props.count === undefined ? null : <Text style={chipCount(theme)}>{props.count}</Text>}
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
                        <View style={chipPill(theme, false, pressed)}>
                            <Text style={chipLabel(theme, false)}>{visibleChipLabel(props.label)}</Text>
                            <Icon name="x" size={16} />
                        </View>
                    )}
                </Pressable>
            );
    }
};
