/**
 * @module @commise/ui/chip — the native design-system {@link ChipRow}.
 *
 * In `filter` and `input` mode the row is a named `group` around the chips the screen places. In `choice` mode it owns
 * its options: a named `radiogroup` of `radio`s with `aria-checked`. Pressing an option chooses it; pressing the chosen
 * option again clears the choice only when the row is `clearable`. A `scroll` row is one line in the design-system
 * `HorizontalScroller`, which owns its scroll indicator, fade and chevron; a `wrap` row wraps.
 *
 * @pattern Composite — the row owns the group semantics its chips cannot state alone
 */
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HorizontalScroller } from '../horizontalScroller/HorizontalScroller.native.js';
import { Icon } from '../icon/Icon.native.js';
import { nativeTokens } from '../tokens/native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { visibleChipLabel } from './chipLabel.js';
import { CHIP_LABEL_LINES, chipHit, chipHitHeight, chipLabel, chipPill } from './chipStyle.js';
import type { ChipRowOverflow, ChipRowProps, ChipRowSurface, ChoiceRowProps } from './props.js';

/**
 * Lay chips out on one scrolling line, or wrapped. The wrapping line is the only row box between the group and its
 * chips: inside another row box it would size to its content, which React Native does not shrink, and never wrap.
 */
const Lines: FC<{
    readonly overflow: ChipRowOverflow;
    readonly surface: ChipRowSurface;
    readonly children: ReactNode;
}> = ({ overflow, surface, children }) =>
    overflow === 'scroll' ? (
        <HorizontalScroller surface={surface} snap={{ kind: 'item' }}>
            <View style={styles.line}>{children}</View>
        </HorizontalScroller>
    ) : (
        <View style={styles.wrap}>{children}</View>
    );

/** The value a press on an option reports, or `undefined` when the press changes nothing. Pure. */
export function choiceAfterPress(
    chosen: string | null,
    pressed: string,
    clearable: boolean,
): string | null | undefined {
    if (pressed !== chosen) {
        return pressed;
    }

    return clearable ? null : undefined;
}

/** A choice row. */
const ChoiceRow: FC<ChoiceRowProps> = ({
    label,
    overflow,
    options,
    value,
    onChange,
    clearable = false,
    surface = 'canvas',
}) => {
    const theme = useTheme();

    return (
        <View collapsable={false} role="radiogroup" aria-label={label}>
            <Lines overflow={overflow} surface={surface}>
                {options.map((option) => {
                    const chosen = option.value === value;

                    return (
                        <Pressable
                            key={option.value}
                            role="radio"
                            aria-checked={chosen}
                            aria-label={option.label}
                            onPress={() => {
                                const next = choiceAfterPress(value, option.value, clearable);

                                if (next !== undefined) {
                                    onChange(next);
                                }
                            }}
                            style={[chipHit, { minHeight: chipHitHeight() }]}
                        >
                            {({ pressed }) => (
                                <View style={chipPill(theme, chosen, pressed)}>
                                    {chosen ? <Icon name="check" size={16} tone="actionText" /> : null}
                                    <Text style={chipLabel(theme, chosen)} numberOfLines={CHIP_LABEL_LINES}>
                                        {visibleChipLabel(option.label)}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    );
                })}
            </Lines>
        </View>
    );
};

/** The native design-system chip row. */
export const ChipRow: FC<ChipRowProps> = (props) =>
    props.mode === 'choice' ? (
        <ChoiceRow {...props} />
    ) : (
        <View collapsable={false} role="group" aria-label={props.label}>
            <Lines overflow={props.overflow} surface={props.surface ?? 'canvas'}>
                {props.children}
            </Lines>
        </View>
    );

const styles = StyleSheet.create({
    line: { flexDirection: 'row', gap: nativeTokens.spacing[2], paddingEnd: nativeTokens.spacing[4] },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
});
