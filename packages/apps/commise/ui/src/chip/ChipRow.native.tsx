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
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type FC, type ReactNode } from 'react';
import {
    I18nManager,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { nativeTokens } from '../tokens/native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { visibleChipLabel } from './chipLabel.js';
import { chipHit, chipHitHeight, chipLabel, chipPill } from './chipStyle.js';
import type { ChipRowOverflow, ChipRowProps, ChipRowSurface, ChoiceRowProps } from './props.js';

/** How wide the fade at a scrolling row's end is, in dp (`buildSpec.md` §1.11). */
const FADE_WIDTH = 24;

/** What a scrolling row knows about how much of itself shows. */
interface ScrollExtent {
    readonly viewport: number;
    readonly content: number;
    readonly offset: number;
}

/** Whether chips lie past the end of the box. Pure. */
export function hasMoreAhead({ viewport, content, offset }: ScrollExtent): boolean {
    return viewport > 0 && content - viewport - offset > 1;
}

/**
 * One scrolling line of chips, with a fade over its end while more lies beyond it. Without the fade a chip cut at the
 * edge reads as a layout bug and not as a row that scrolls; the web row masks its end for the same reason.
 */
const ScrollingLine: FC<{ readonly surface: ChipRowSurface; readonly children: ReactNode }> = ({
    surface,
    children,
}) => {
    const theme = useTheme();
    const ground = theme.colors[surface === 'overlay' ? 'paperOverlay' : 'canvas'];
    const [extent, setExtent] = useState<ScrollExtent>({ viewport: 0, content: 0, offset: 0 });
    const rtl = I18nManager.isRTL;

    return (
        <View style={styles.scrollBox}>
            {/* One `scrollsToTop` per screen: a chip row never takes the iOS status-bar tap from the screen's scroller. */}
            <ScrollView
                horizontal
                scrollsToTop={false}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.line}
                scrollEventThrottle={32}
                onLayout={(event: LayoutChangeEvent) => {
                    const viewport = event.nativeEvent.layout.width;
                    setExtent((previous) => ({ ...previous, viewport }));
                }}
                onContentSizeChange={(content) => setExtent((previous) => ({ ...previous, content }))}
                onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
                    const offset = Math.abs(event.nativeEvent.contentOffset.x);
                    setExtent((previous) => ({ ...previous, offset }));
                }}
            >
                {children}
            </ScrollView>
            {hasMoreAhead(extent) ? (
                <View
                    aria-hidden
                    pointerEvents="none"
                    style={[styles.fadeBox, rtl ? styles.fadeLeft : styles.fadeRight]}
                >
                    <LinearGradient
                        colors={[`${ground}00`, ground]}
                        start={{ x: rtl ? 1 : 0, y: 0 }}
                        end={{ x: rtl ? 0 : 1, y: 0 }}
                        style={styles.fade}
                    />
                </View>
            ) : null}
        </View>
    );
};

/** Lay chips out on one scrolling line, or wrapped. */
const Lines: FC<{
    readonly overflow: ChipRowOverflow;
    readonly surface: ChipRowSurface;
    readonly children: ReactNode;
}> = ({ overflow, surface, children }) =>
    overflow === 'scroll' ? (
        <ScrollingLine surface={surface}>{children}</ScrollingLine>
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
        <View collapsable={false} role="radiogroup" aria-label={label} style={overflow === 'wrap' ? styles.wrap : null}>
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
            <Lines overflow={props.overflow} surface={props.surface ?? 'canvas'}>
                {props.children}
            </Lines>
        </View>
    );

const styles = StyleSheet.create({
    scrollBox: { position: 'relative' },
    fadeBox: { position: 'absolute', top: 0, bottom: 0, width: FADE_WIDTH },
    fadeRight: { right: 0 },
    fadeLeft: { left: 0 },
    fade: { flex: 1 },
    line: { flexDirection: 'row', gap: nativeTokens.spacing[2], paddingEnd: nativeTokens.spacing[4] },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
});
