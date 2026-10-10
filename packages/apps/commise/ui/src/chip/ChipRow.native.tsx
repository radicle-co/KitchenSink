/**
 * @module @commise/ui/chip — the native design-system {@link ChipRow}.
 *
 * In `filter` and `input` mode the row is a named `group` around the chips the screen places. In `choice` mode it owns
 * its options: a named `radiogroup` of `radio`s with `aria-checked`. Pressing an option chooses it; pressing the chosen
 * option again clears the choice only when the row is `clearable`. A `scroll` row is one horizontal `ScrollView` line;
 * a `wrap` row wraps.
 *
 * @pattern Composite — the row owns the group semantics its chips cannot state alone
 */
import type { FC, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { nativeTokens } from '../tokens/native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { visibleChipLabel } from './chipLabel.js';
import { chipHit, chipHitHeight, chipLabel, chipPill } from './chipStyle.js';
import type { ChipRowOverflow, ChipRowProps, ChoiceRowProps } from './props.js';

/** Lay chips out on one scrolling line, or wrapped. */
const Lines: FC<{ readonly overflow: ChipRowOverflow; readonly children: ReactNode }> = ({ overflow, children }) =>
    overflow === 'scroll' ? (
        // One `scrollsToTop` per screen: a chip row never takes the iOS status-bar tap from the screen's scroller.
        <ScrollView
            horizontal
            scrollsToTop={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.line}
        >
            {children}
        </ScrollView>
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
const ChoiceRow: FC<ChoiceRowProps> = ({ label, overflow, options, value, onChange, clearable = false }) => {
    const theme = useTheme();

    return (
        <View collapsable={false} role="radiogroup" aria-label={label} style={overflow === 'wrap' ? styles.wrap : null}>
            <Lines overflow={overflow}>
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
                                    <Text style={chipLabel(theme, chosen)}>{visibleChipLabel(option.label)}</Text>
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
        <View
            collapsable={false}
            role="group"
            aria-label={props.label}
            style={props.overflow === 'wrap' ? styles.wrap : null}
        >
            <Lines overflow={props.overflow}>{props.children}</Lines>
        </View>
    );

const styles = StyleSheet.create({
    line: { flexDirection: 'row', gap: nativeTokens.spacing[2], paddingEnd: nativeTokens.spacing[4] },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
});
