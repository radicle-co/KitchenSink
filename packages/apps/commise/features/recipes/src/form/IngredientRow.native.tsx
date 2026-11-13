/**
 * @module @commise/features-recipes/form — `IngredientRow` (native): one ingredient row (build spec §7.5.1). The React
 * Native leaf of `./IngredientRow.tsx`: at rest it READS (the amount, then the name and " · " the
 * preparation, then its `⋯`), and the amount and name together are its open control, "Edit {amount} {food}". A row that
 * needs the cook adds an `attention` line that opens its panel in a sheet, or its food search. While its food search is
 * open, the name is the entry combobox, Android back leaves it and the keyboard closing ends it when nothing new was
 * typed (item 4). On a tablet its inline editor sits under it.
 *
 * The amount and the name are ONE text run (#144), so nothing narrower than the row can break a word: the old amount
 * column made React Native split "tablespoon / s". The row's second line starts at the row's start edge.
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
import { useFieldStartReveal } from '@commise/ui/field-reveal';
import { useFocusRequest } from '@commise/ui/focus-request';
import { Icon } from '@commise/ui/icon';
import { useKeyboardHidden } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { Popover } from '@commise/ui/popover';
import { moveScreenReaderFocus } from '@commise/ui/screen-reader-focus';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { Text } from '@commise/ui/text';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useRef, type FC, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AmountRun } from './AmountRun.native.js';
import { PREP_JOINER } from '../format/prepJoiner.js';
import { ingredientRowId } from './fieldIds.js';
import { ingredientCommitFailureId, ingredientNoFoodNoteId, ingredientStandInId } from './fieldErrorIds.js';
import { rowBadgeStatus } from './ingredientRowPolicy.js';
import type { IngredientRowView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';
import { PrivateFoodNote } from './PrivateFoodNote.native.js';
import { rowEntryFieldOf, type RowEntryFieldCopy } from './rowEntryField.js';
import { usePressFill } from '@commise/ui/surface-tone';

/** Props for {@link IngredientRow}. */
export interface IngredientRowProps {
    readonly row: IngredientRowView;
    readonly m: RecipeFormMessages;
    readonly entryCopy: RowEntryFieldCopy;
    readonly panel: (close: () => void) => ReactNode;
    readonly inlineEditor: ReactNode;
    readonly expanded: boolean | undefined;
    /**
     * The row a pick just added, until the cook moves on: it wears the `selectedFill` tint, for the eye only
     * (`docs/design/uiOverhaul/ingredientArrival.md`). Nothing is announced and nothing animates; native snaps it off.
     */
    readonly arrived?: boolean;
    /** The row's layout, so the screen can say how far the field under it is from the row's top. */
    readonly onLayout?: (event: LayoutChangeEvent) => void;
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
}> = ({ row, expanded }) => {
    const wash = usePressFill();
    const node = useRef<View>(null);
    const { requested, onHandled } = row.openFocus;

    useFocusRequest(requested, () => moveScreenReaderFocus(node.current), onHandled);

    // The strong face in the run's own size: `figureInline` has none and takes its parent's.
    const amount =
        row.amountText === '' ? null : (
            <Text typeRole="figureInline" color="$ink">
                {row.amountText}
            </Text>
        );

    return (
        <Pressable
            ref={node}
            accessibilityRole="button"
            accessibilityLabel={row.openLabel}
            {...(row.countedAs === undefined ? {} : { accessibilityHint: row.countedAs })}
            {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
            onPress={row.onOpen}
            style={({ pressed }) => [styles.open, pressed && { backgroundColor: wash }]}
        >
            {/* One text run (#144): the amount in the strong weight, an ordinary space, then the food. React Native
                breaks only between words while the run has the row's full width. No amount: no span and no space,
                never an invented "1" (F5). A stand-in is a chip, not text, so the amount sits above it. */}
            <View style={styles.name}>
                {row.standIn ? (
                    <>
                        {amount !== null && (
                            // A stand-in's amount has no text parent to take a size from: the body role is its line.
                            <Text typeRole="body" color="$ink">
                                {amount}
                            </Text>
                        )}
                        <View nativeID={ingredientStandInId(row.index)}>
                            <StandIn tone={row.presentation.tone}>{row.displayName}</StandIn>
                        </View>
                    </>
                ) : (
                    <AmountRun amount={row.amountText}>
                        {row.displayName}
                        {row.noteText !== undefined && (
                            <Text typeRole="body" color="$inkMuted">{`${PREP_JOINER}${row.noteText}`}</Text>
                        )}
                        {row.prepText !== undefined && (
                            <Text typeRole="body" color="$inkMuted">{`${PREP_JOINER}${row.prepText}`}</Text>
                        )}
                    </AmountRun>
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
    panel,
    inlineEditor,
    expanded,
    arrived = false,
    onLayout,
}) => {
    const { colors } = useTheme();
    const { secondLine, line } = row;
    // The node the scroll host measures when a deep link names this row's start (`ScrollHost.scrollToStart`): the DOM-like
    // handle of an external, imperative system (`measureLayout`), which has no declarative form.
    const node = useRef<View>(null);

    useFieldStartReveal(ingredientRowId(line.key), node);

    return (
        <View
            ref={node}
            role="listitem"
            collapsable={false}
            {...(onLayout === undefined ? {} : { onLayout })}
            style={[
                styles.item,
                { borderBottomColor: colors.lineDivider },
                arrived && { backgroundColor: colors.selectedFill },
            ]}
        >
            {row.inEntry && <EntryExits onBack={row.onLeaveEntry} onKeyboardHidden={row.onFocusLeft} />}
            <View style={styles.top}>
                {row.inEntry ? (
                    <View style={styles.entry}>
                        {row.youWroteInline !== undefined && (
                            <Text typeRole="caption" color="$inkMuted">
                                {row.youWroteInline}
                            </Text>
                        )}
                        <Combobox
                            {...rowEntryFieldOf(row.entryField, entryCopy)}
                            // PLATFORM-FORK: native has no `aria-describedby`, so a refused field says its row sentence as
                            // its own `error` (drawn, and the head of its hint), never in an assertive alert, and never by
                            // taking focus: the keyboard and the list stay down (buildSpec §7.8). The first tap opens the
                            // list.
                            {...(row.pendingText === undefined ? {} : { error: row.pendingText, openOnFocus: true })}
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
                    <OpenControl row={row} expanded={expanded} />
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
            <View style={styles.second}>
                {secondLine.kind === 'working' && (
                    <View style={styles.inline}>
                        <View aria-hidden>
                            <Icon name="refreshCw" size={16} tone="inkMuted" />
                        </View>
                        <Text typeRole="caption" color="$inkMuted">
                            {secondLine.text}
                        </Text>
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
                        <Text typeRole="caption" color="$attention">
                            {secondLine.text}
                        </Text>
                    </Pressable>
                )}
                {row.countedAs !== undefined && (
                    // The matched food, for the editor only: the open control's hint (design answers 2026-11-08).
                    <Text typeRole="caption" color="$inkMuted">
                        {row.countedAs}
                    </Text>
                )}
                {row.privateFood !== undefined && <PrivateFoodNote view={row.privateFood} />}
                {row.amountInvalidNote !== undefined && (
                    <Text typeRole="caption" color="$dangerText">
                        {row.amountInvalidNote}
                    </Text>
                )}
                {row.busyText !== undefined && (
                    <Text typeRole="caption" color="$inkMuted">
                        {row.busyText}
                    </Text>
                )}
                {row.failure !== undefined && (
                    // Shown on the row; the field says it assertively, so this text is not live too (system change 2).
                    <Text nativeID={ingredientCommitFailureId(line.key)} typeRole="caption" color="$dangerText">
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
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    name: { flex: 1, gap: nativeTokens.spacing[1] },
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
});
