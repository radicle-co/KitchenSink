/**
 * @module @commise/features-recipes/form — `IngredientRow` (native): one ingredient row (build spec §7.5.1). The React
 * Native leaf of `./IngredientRow.tsx`: at rest it READS (the amount in a fixed column, then the name and " · " the
 * preparation, then its `⋯`), and the amount and name together are its open control, "Edit {amount} {food}". A row that
 * needs the cook adds an `attention` line that opens its panel in a sheet, or its food search. While its food search is
 * open, the name is the entry combobox, Android back leaves it and the keyboard closing ends it when nothing new was
 * typed (item 4). On a tablet its inline editor sits under it.
 *
 * Presentational: `props → JSX` over the row's view.
 *
 * @pattern Strategy — the read row or the entry row, chosen by the view's `inEntry`
 * @pattern Adapter over the screen-reader focus API — the open control takes a level-triggered focus request, which
 *     only `moveScreenReaderFocus` on its node can carry; it is the one reason this leaf holds a ref
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { useBackIntercept } from '@commise/ui/back-intercept';
import { Combobox } from '@commise/ui/combobox';
import { Icon } from '@commise/ui/icon';
import { useKeyboardHidden } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { Popover } from '@commise/ui/popover';
import { moveScreenReaderFocus } from '@commise/ui/screen-reader-focus';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useEffect, useEffectEvent, useRef, type FC, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
    ingredientCommitFailureId,
    ingredientNoFoodNoteId,
    ingredientPendingTextId,
    ingredientStandInId,
} from './fieldErrorIds.js';
import { rowBadgeStatus } from './ingredientRowPolicy.js';
import type { IngredientRowView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';
import { rowEntryFieldOf, type RowEntryFieldCopy } from './rowEntryField.js';
import type { SpeakRefusal } from './useSpokenRefusal.js';

/** Props for {@link IngredientRow}. */
export interface IngredientRowProps {
    readonly row: IngredientRowView;
    readonly m: RecipeFormMessages;
    readonly entryCopy: RowEntryFieldCopy;
    readonly speak: SpeakRefusal;
    readonly panel: (close: () => void) => ReactNode;
    readonly inlineEditor: ReactNode;
    readonly expanded: boolean | undefined;
    /** The amount column's width: 72 pt below a 600 container, 96 from 600 (§7.5.1). */
    readonly amountColumn: number;
}

/**
 * Native's two ways out of a row's food search (item 4). Android back cancels it; the keyboard closing ends it when
 * nothing new was typed, the native reading of focus leaving the row. Mounted only while the search is open, so the
 * back chain, which asks its newest link first, offers it the press before the editor's own guard.
 */
const EntryExits: FC<{ readonly onBack: () => void; readonly onKeyboardHidden: () => void }> = ({
    onBack,
    onKeyboardHidden,
}) => {
    useBackIntercept(() => {
        onBack();

        return true;
    });
    useKeyboardHidden(onKeyboardHidden);

    return null;
};

/** The open control: amount and name, one button named "Edit {amount} {food}". */
const OpenControl: FC<{
    readonly row: IngredientRowView;
    readonly expanded: boolean | undefined;
    readonly amountColumn: number;
}> = ({ row, expanded, amountColumn }) => {
    const { colors, wash } = useTheme();
    const node = useRef<View>(null);
    const { requested, onHandled } = row.openFocus;
    // The acknowledgement is not a dependency: a host's new callback must not re-run a request already taken.
    const acknowledge = useEffectEvent(() => onHandled());

    useEffect(() => {
        if (!requested) {
            return;
        }

        moveScreenReaderFocus(node.current);
        acknowledge();
    }, [requested]);

    return (
        <Pressable
            ref={node}
            accessibilityRole="button"
            accessibilityLabel={row.openLabel}
            {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
            onPress={row.onOpen}
            style={({ pressed }) => [styles.open, pressed && { backgroundColor: wash }]}
        >
            {/* No amount: the column stays empty, never an invented "1" (F5). */}
            <Text style={[styles.amount, { width: amountColumn, color: colors.ink }]}>{row.amountText}</Text>
            <View style={styles.name}>
                {row.standIn ? (
                    <View nativeID={ingredientStandInId(row.index)}>
                        <StandIn tone={row.presentation.tone}>{row.displayName}</StandIn>
                    </View>
                ) : (
                    <Text numberOfLines={2} style={[styles.body, { color: colors.ink }]}>
                        {row.displayName}
                        {row.prepText !== undefined && (
                            <Text style={{ color: colors.inkMuted }}>{` · ${row.prepText}`}</Text>
                        )}
                    </Text>
                )}
                {row.variantParts !== undefined && <VariantPartsLine parts={row.variantParts} tone="secondary" />}
            </View>
        </Pressable>
    );
};

/** One ingredient row. */
export const IngredientRow: FC<IngredientRowProps> = ({
    row,
    m,
    entryCopy,
    speak,
    panel,
    inlineEditor,
    expanded,
    amountColumn,
}) => {
    const { colors } = useTheme();
    const { secondLine, line } = row;
    const caption = [styles.caption, { color: colors.inkMuted }];
    const error = [styles.caption, { color: colors.dangerText }];

    return (
        <View role="listitem" collapsable={false} style={[styles.item, { borderBottomColor: colors.lineDivider }]}>
            {row.inEntry && <EntryExits onBack={row.onLeaveEntry} onKeyboardHidden={row.onFocusLeft} />}
            <View style={styles.top}>
                {row.inEntry ? (
                    <View style={styles.entry}>
                        <Combobox
                            // PLATFORM-FORK: native has no `aria-describedby`, so a refused field says its row sentence
                            // in its own alert (`useSpokenRefusal`); on web the sentence describes the field.
                            {...rowEntryFieldOf(speak(row.entryField, line.key, row.pendingText), entryCopy)}
                            loadingIcon={<Icon name="search" size={16} tone="inkMuted" />}
                            // A search that would keep a food has Cancel instead (item 4).
                            {...(row.entryField.changing
                                ? {}
                                : {
                                      clear: {
                                          label: m.ingredientEntryClear,
                                          icon: <Icon name="x" size={20} tone="inkMuted" />,
                                      },
                                  })}
                        />
                        {row.noFoodNote !== undefined && (
                            <View nativeID={ingredientNoFoodNoteId(row.index)} role="note">
                                <StatusBadge status={rowBadgeStatus(row.presentation.tone)}>
                                    {row.noFoodNote}
                                </StatusBadge>
                            </View>
                        )}
                    </View>
                ) : (
                    <OpenControl row={row} expanded={expanded} amountColumn={amountColumn} />
                )}
                <ActionMenu
                    triggerLabel={row.labels.actionsTrigger}
                    title={row.displayName}
                    closeLabel={row.labels.actionsClose}
                    items={row.actions}
                    destructiveItem={row.destructiveAction}
                    focusRequested={row.actionsFocus.requested}
                    onFocusRequestHandled={row.actionsFocus.onHandled}
                    unavailable={row.busy}
                />
            </View>
            <View style={[styles.second, { paddingLeft: amountColumn + nativeTokens.spacing[3] }]}>
                {secondLine.kind === 'working' && (
                    <View style={styles.inline}>
                        <View aria-hidden>
                            <Icon name="refreshCw" size={16} tone="inkMuted" />
                        </View>
                        <Text style={caption}>{secondLine.text}</Text>
                    </View>
                )}
                {secondLine.kind === 'attention' && secondLine.opens === 'panel' && (
                    <Popover
                        triggerLabel={secondLine.label}
                        triggerText={secondLine.text}
                        triggerIcon="triangleAlert"
                        title={row.displayName}
                        closeLabel={row.labels.panelClose}
                        busy={row.busy && (row.body.kind === 'candidates' || row.body.kind === 'shortlist')}
                    >
                        {panel}
                    </Popover>
                )}
                {secondLine.kind === 'attention' && secondLine.opens === 'entry' && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={secondLine.label}
                        onPress={row.onBeginEntry}
                        style={styles.attention}
                    >
                        <View aria-hidden>
                            <Icon name="triangleAlert" size={16} tone="attention" />
                        </View>
                        <Text style={[styles.caption, { color: colors.attention }]}>{secondLine.text}</Text>
                    </Pressable>
                )}
                {row.amountInvalidNote !== undefined && <Text style={error}>{row.amountInvalidNote}</Text>}
                {row.busyText !== undefined && <Text style={caption}>{row.busyText}</Text>}
                {row.pendingText !== undefined && (
                    <Text nativeID={ingredientPendingTextId(line.key)} style={error}>
                        {row.pendingText}
                    </Text>
                )}
                {row.failure !== undefined && (
                    // Shown on the row; the field says it assertively, so this text is not live too (system change 2).
                    <Text nativeID={ingredientCommitFailureId(line.key)} style={error}>
                        {row.failure}
                    </Text>
                )}
            </View>
            {inlineEditor}
        </View>
    );
};

const styles = StyleSheet.create({
    item: { borderBottomWidth: StyleSheet.hairlineWidth },
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: nativeTokens.spacing[2] },
    open: {
        flex: 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    amount: { ...nativeTokens.type.label, fontVariant: ['tabular-nums'] },
    name: { flex: 1, gap: nativeTokens.spacing[1] },
    body: { ...nativeTokens.type.body },
    entry: { flex: 1, gap: nativeTokens.spacing[1], paddingVertical: nativeTokens.spacing[2] },
    second: { gap: nativeTokens.spacing[1] },
    inline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        paddingBottom: nativeTokens.spacing[2],
    },
    attention: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        minHeight: 48,
        alignSelf: 'flex-start',
    },
    caption: { ...nativeTokens.type.caption },
});
