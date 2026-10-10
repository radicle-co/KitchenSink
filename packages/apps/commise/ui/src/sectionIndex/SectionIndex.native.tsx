/**
 * @module @commise/ui/section-index — the native design-system {@link SectionIndex} (`buildSpec.md` §7.2, §7.10,
 * §7.12).
 *
 * The same items as the web leaf, presented by the window's container class (`useContainerClass`; native has no
 * sidebar, so the window decides): a **rail** at `wide` (a tablet in landscape), a **strip** at `regular`, a **bar**
 * that opens the native `Sheet` at `narrow`. Only the chosen presentation renders.
 *
 * React Native has no `aria-describedby`, so a row's reason (and, in the rail and the sheet, its hint) reaches a screen
 * reader as the row's `accessibilityHint`, read after its name — the house form (`IngredientCheckRow.native.tsx`).
 * Every jump goes through the screen's ONE `ScrollHost`, then `onJump`, where the editor moves accessibility focus to
 * the heading (the host holds no heading refs). The sheet jumps from its `onDismissed`, once the Modal is gone, so that
 * focus move lands on the screen and not on a closing Modal. Colours come from `useTheme()` at render (D15); the
 * surfaces are solid `paperRaised` (D12: the editor's only glass is its action bar). Every `ScrollView` here sets
 * `scrollsToTop={false}`: the status-bar tap belongs to the screen's one scroller (§3.6).
 *
 * Presentational about data: props → elements; its one piece of state is the open sheet and its pending jump.
 *
 * @pattern Strategy — one item list, three presentations chosen by the container class
 * @pattern Mediator client — a choice is handed to the screen's `ScrollHost`, which performs the jump
 */
import { useState, type FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useContainerClass } from '../layout/useContainerClass.native.js';
import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import { Sheet } from '../sheet/Sheet.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { SectionIndexItem, SectionIndexProps } from './props.js';
import {
    TONE_GLYPH,
    TONE_ROLE,
    TONE_SEGMENT,
    barCountRoleOf,
    barItemOf,
    descriptionOf,
    shownCountOf,
} from './sectionIndexModel.js';

type Colors = ReturnType<typeof useTheme>['colors'];

/** The props a row's `Pressable` takes as a link: its name, its description and whether it is current. */
function linkProps(item: SectionIndexItem, current: boolean, withHint: boolean) {
    const hint = descriptionOf(item, withHint);

    return {
        role: 'link' as const,
        'aria-label': item.label,
        ...(hint === undefined ? {} : { accessibilityHint: hint }),
        // React Native has no `aria-current`; the selected state is what a device's screen reader hears for "you are
        // here" (§1.10). `aria-current` is kept for react-native-web, which writes it to the DOM.
        'aria-selected': current,
        ...(current ? { 'aria-current': 'location' as const } : {}),
    };
}

interface ListRowProps {
    readonly item: SectionIndexItem;
    readonly current: boolean;
    /** `rail` rows are at least 48 pt; `sheet` rows 56 pt (§7.10). */
    readonly height: 'rail' | 'sheet';
    readonly colors: Colors;
    readonly onChoose: () => void;
}

/** One rail or sheet row: the label, then the status line in `caption`, then the hint. */
const ListRow: FC<ListRowProps> = ({ item, current, height, colors, onChoose }) => {
    const glyph = TONE_GLYPH[item.tone];

    return (
        <Pressable
            {...linkProps(item, current, true)}
            onPress={onChoose}
            style={({ pressed }) => [
                styles.row,
                height === 'rail' ? styles.railRow : styles.sheetRow,
                pressed ? { backgroundColor: colors.surfaceMuted } : null,
            ]}
        >
            {current ? <View style={[styles.startBar, { backgroundColor: colors.hereBar }]} /> : null}
            <View style={styles.line}>
                {item.tone === 'complete' && glyph !== undefined ? <Icon name={glyph} size={16} tone="ink" /> : null}
                <Text
                    numberOfLines={2}
                    style={[
                        current ? styles.labelCurrent : styles.label,
                        { color: current ? colors.ink : colors.inkMuted },
                    ]}
                >
                    {item.label}
                </Text>
            </View>
            {item.reason !== undefined ? (
                <View style={styles.line}>
                    {item.tone !== 'complete' && glyph !== undefined ? (
                        <Icon name={glyph} size={16} tone={TONE_ROLE[item.tone]} />
                    ) : null}
                    <Text numberOfLines={2} style={[styles.caption, { color: colors[TONE_ROLE[item.tone]] }]}>
                        {item.reason}
                    </Text>
                </View>
            ) : null}
            {item.hint !== undefined ? (
                <Text style={[styles.caption, { color: colors.inkMuted }]}>{item.hint}</Text>
            ) : null}
        </Pressable>
    );
};

interface StripItemProps {
    readonly item: SectionIndexItem;
    readonly current: boolean;
    readonly colors: Colors;
    readonly onChoose: () => void;
}

/** One strip item: glyph, the short label, the count; the reason as the item's hint. */
const StripItem: FC<StripItemProps> = ({ item, current, colors, onChoose }) => {
    const glyph = TONE_GLYPH[item.tone];
    const count = shownCountOf(item);

    return (
        <Pressable {...linkProps(item, current, false)} onPress={onChoose} style={styles.stripItem}>
            {glyph !== undefined ? <Icon name={glyph} size={16} tone={TONE_ROLE[item.tone]} /> : null}
            <Text
                numberOfLines={1}
                style={[
                    current ? styles.labelCurrent : styles.label,
                    styles.shrink,
                    { color: current ? colors.ink : colors.inkMuted },
                ]}
            >
                {item.shortLabel ?? item.label}
            </Text>
            {count !== undefined ? (
                <Text aria-hidden style={[styles.labelCurrent, { color: colors[TONE_ROLE[item.tone]] }]}>
                    {count}
                </Text>
            ) : null}
            {current ? <View style={[styles.underBar, { backgroundColor: colors.hereBar }]} /> : null}
        </Pressable>
    );
};

/** The native section index. */
export const SectionIndex: FC<SectionIndexProps> = ({
    label,
    sheetTitle,
    sheetCloseLabel,
    items,
    currentId,
    barName,
    barSuffix,
    barCount,
    railFooter,
    onJump,
}) => {
    const { colors } = useTheme();
    const host = useScrollHost();
    const containerClass = useContainerClass();
    const [sheetOpen, setSheetOpen] = useState(false);
    // The section chosen in the sheet, jumped to once the sheet has gone (see the module note).
    const [pendingJump, setPendingJump] = useState<string | undefined>(undefined);

    const jump = (id: string): void => {
        host.scrollToSection(id);
        onJump?.(id);
    };

    if (containerClass === 'wide') {
        return (
            <View collapsable={false} role="navigation" aria-label={label} style={styles.rail}>
                <ScrollView scrollsToTop={false} contentContainerStyle={styles.railList}>
                    {items.map((item) => (
                        <ListRow
                            key={item.id}
                            item={item}
                            current={item.id === currentId}
                            height="rail"
                            colors={colors}
                            onChoose={() => {
                                jump(item.id);
                            }}
                        />
                    ))}
                    {railFooter !== undefined && railFooter !== null ? (
                        <View style={[styles.railFooter, { borderTopColor: colors.lineDivider }]}>{railFooter}</View>
                    ) : null}
                </ScrollView>
            </View>
        );
    }

    if (containerClass === 'regular') {
        return (
            <View
                collapsable={false}
                role="navigation"
                aria-label={label}
                style={[styles.strip, { backgroundColor: colors.paperRaised, borderBottomColor: colors.lineDivider }]}
            >
                {items.map((item) => (
                    <StripItem
                        key={item.id}
                        item={item}
                        current={item.id === currentId}
                        colors={colors}
                        onChoose={() => {
                            jump(item.id);
                        }}
                    />
                ))}
            </View>
        );
    }

    const barItem = barItemOf(items, currentId);

    return (
        <View style={{ backgroundColor: colors.paperRaised }}>
            <Pressable
                role="button"
                aria-label={barName}
                aria-expanded={sheetOpen}
                onPress={() => {
                    setSheetOpen(true);
                }}
                style={styles.bar}
            >
                <Text numberOfLines={1} style={[styles.labelCurrent, styles.shrink, { color: colors.ink }]}>
                    {barItem?.label}
                    {barSuffix !== undefined ? (
                        <Text style={[styles.label, { color: colors.inkMuted }]}>{barSuffix}</Text>
                    ) : null}
                </Text>
                {barCount !== undefined ? (
                    <Text aria-hidden style={[styles.labelCurrent, { color: colors[barCountRoleOf(items)] }]}>
                        {barCount}
                    </Text>
                ) : null}
                <Icon name="chevronDown" size={20} />
            </Pressable>
            <View aria-hidden style={styles.progress}>
                {items.map((item) => {
                    const segment = TONE_SEGMENT[item.tone];

                    return (
                        <View
                            key={item.id}
                            style={[
                                styles.segment,
                                segment === 'done' ? { backgroundColor: colors.action } : null,
                                segment === 'needsAction'
                                    ? {
                                          backgroundColor: colors.attentionTint,
                                          borderTopWidth: 1,
                                          borderTopColor: colors.attention,
                                      }
                                    : null,
                                segment === 'empty' ? { backgroundColor: colors.surfaceMuted } : null,
                            ]}
                        />
                    );
                })}
            </View>
            <Sheet
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                onDismissed={() => {
                    if (pendingJump !== undefined) {
                        setPendingJump(undefined);
                        jump(pendingJump);
                    }
                }}
                title={sheetTitle}
                closeLabel={sheetCloseLabel}
                size="content"
            >
                {items.map((item) => (
                    <ListRow
                        key={item.id}
                        item={item}
                        current={item.id === currentId}
                        height="sheet"
                        colors={colors}
                        onChoose={() => {
                            setPendingJump(item.id);
                            setSheetOpen(false);
                        }}
                    />
                ))}
            </Sheet>
        </View>
    );
};

const styles = StyleSheet.create({
    rail: { width: 240, flexShrink: 0 },
    railList: { gap: nativeTokens.spacing[1] },
    railFooter: {
        marginTop: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    row: {
        justifyContent: 'center',
        gap: 2,
        paddingVertical: nativeTokens.spacing[2],
        paddingStart: nativeTokens.spacing[4],
        paddingEnd: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    railRow: { minHeight: 48 },
    sheetRow: { minHeight: 56 },
    startBar: { position: 'absolute', top: 4, bottom: 4, start: 0, width: 3, borderRadius: 2 },
    line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    // The label at 400 is the `meta` face: a native face is chosen by weight, never by `fontWeight` (tokens/native.ts).
    label: { ...nativeTokens.type.meta },
    labelCurrent: { ...nativeTokens.type.label },
    caption: { ...nativeTokens.type.caption, flexShrink: 1 },
    shrink: { flexShrink: 1, minWidth: 0 },
    strip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        minHeight: 48,
        paddingHorizontal: nativeTokens.spacing[2],
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    stripItem: {
        flexShrink: 1,
        minWidth: 0,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: nativeTokens.spacing[3],
    },
    underBar: { position: 'absolute', bottom: 0, start: 12, end: 12, height: 3, borderRadius: 2 },
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    progress: { flexDirection: 'row', height: 4, gap: 2 },
    segment: { flex: 1 },
});
