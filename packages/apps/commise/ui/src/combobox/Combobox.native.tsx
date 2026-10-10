/**
 * @module @commise/ui/combobox — the native `Combobox`: a text field with its suggestions listed below it, chosen by a
 * tap (`docs/design/ingredientStatusExplanation.md` §2a, §3, §8e). A presentational design-system primitive with the
 * web leaf's contract: the host owns the text and the suggestions, and this leaf holds only whether the list shows.
 *
 * - ⛔ Typing never selects (3.2.2); a tap on an option is the only choice.
 * - The list is in the page flow below the field (`docs/design/rowEditorOpenDecisions.md` item 7): on Android a child
 *   drawn outside its parent's bounds takes no touches. It reflows the content below the field.
 * - The list a blur closes is reopened by the field's next focus, when the field still holds text: on native the input
 *   method, the reveal's scroll and an injected drag can blur a focused field mid-search, and the field comes back
 *   focused with its answerable list gone. A close the field chose — a pick — and a focus no list ever followed stay
 *   shut.
 * - A drag on the page closes the list unless it began on the list (`ScrollerDragContext`): with no scroller of its
 *   own, the list scrolls with the page under the finger.
 * - Each time the list goes from hidden to shown, the leaf asks the scroller's host to show the field and three option
 *   rows below it (`FieldRevealContext`, E1). The leaf holds no geometry, and the host decides. Closing the list or
 *   unmounting releases the request.
 * - Options are `button`s, 48 dp tall (React Native has no listbox option, the details dialog's precedent); group
 *   names are headers. A busy option reads busy and refuses a tap. An option shows its label and its variant's parts,
 *   all presentation.
 * - One polite and one assertive `LiveRegion` (both also announce on iOS). The polite one speaks only while the popup
 *   shows (`ComboboxProps.countAnnouncement`); the assertive one is never held back. The status lines are shown and
 *   never live, so nothing is spoken twice.
 * - The popup reads the status line, then the options, then the trailing lines in the host's order (1.3.2;
 *   `docs/design/rowEditorOpenDecisions.md` R1, system change 11). A search in flight is one still line, a glyph and its
 *   label, never placeholder rows (S7 list contract P3).
 * - `Cancel` and a clear button sit at the field's trailing end, 48 dp each. `onAbandon` is not read here: React
 *   Native's `TextInput` reports no Escape key (`onKeyPress` carries Enter, Backspace and typed characters), so a
 *   native entry is abandoned through `cancel` or the host's back intercept.
 *
 * One ref, for what has no declarative form: the field, for `.focus()` and the caret on a host's focus request, and as
 * the node a reveal request hands the host to measure.
 *
 * @pattern Adapter over TextInput
 * @pattern Adapter over the React Native focus API — a level-triggered focus request, acknowledged once taken
 */
import { useContext, useEffect, useEffectEvent, useRef, useState, type FC, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput as NativeTextInput } from 'react-native';

import { FieldRevealContext } from '../fieldReveal/fieldRevealContext.js';
import { ScrollerDragContext } from '../fieldReveal/scrollerDrag.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { TextInput } from '../textInput/TextInput.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { VariantPartsLine } from '../variantPartsLine/VariantPartsLine.native.js';
import type { ComboboxOption, ComboboxProps, ComboboxStatus } from './props.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';

/** The native target floor the spec sets (§3, 2.5.8: 48 × 48 dp). */
const TARGET_DP = 48;

/** The list's gap below the field, and its padding above its first line and below its last. */
const LIST_MARGIN_DP = nativeTokens.spacing[1];
const LIST_PADDING_DP = nativeTokens.spacing[1];

/** The room a reveal asks for below the field: the list's top margin and padding, and three option rows (E1). */
const REVEAL_BELOW_DP = LIST_MARGIN_DP + LIST_PADDING_DP + 3 * TARGET_DP;

/** Releases nothing: what a list that opened with no field to measure hands back. */
const RELEASE_NOTHING = (): void => undefined;

/** One status line, drawn still: a `loading` line is the host's glyph and its label, a note its text. */
const StatusLine: FC<{ readonly line: ComboboxStatus; readonly loadingIcon: ReactNode }> = ({ line, loadingIcon }) => {
    const { colors } = useTheme();

    return line.kind === 'loading' ? (
        <View style={[styles.status, styles.loadingLine]}>
            {loadingIcon !== undefined && (
                // Decorative: the label says what is happening.
                <View aria-hidden importantForAccessibility="no-hide-descendants">
                    {loadingIcon}
                </View>
            )}
            <Text style={[styles.statusText, styles.loadingLabel, { color: colors.inkMuted }]}>{line.label}</Text>
        </View>
    ) : (
        <Text style={[styles.status, styles.statusText, { color: colors.inkMuted }]}>{line.text}</Text>
    );
};

/** The combobox. */
export const Combobox: FC<ComboboxProps> = ({
    label,
    listLabel,
    value,
    onValueChange,
    placeholder,
    groups,
    status,
    trailingStatus = [],
    loadingIcon,
    onSelect,
    onSubmitWithoutChoice,
    countAnnouncement,
    alertAnnouncement = '',
    onFocus,
    cancel,
    clear,
    leadingIcon,
    hint,
    belowField,
    invalid = false,
    focusRequested = false,
    onFocusRequestHandled,
    listRequested = false,
    alertOccurrence,
}) => {
    const [open, setOpen] = useState(false);
    const { colors, wash } = useTheme();
    // Whether the field's last blur closed an open list: the list a blur closes is reopened by the field's next focus
    // (below), while a close the field chose — a pick — and a focus no list ever followed stay shut. A refocus on
    // standing text must not strand the panel closed: on native the input method, the reveal's scroll and an
    // injected drag can blur a focused field mid-search, and the field comes back focused with its answerable list
    // gone — invisible to a cook and to the tests both.
    const closedByBlur = useRef(false);
    const field = useRef<NativeTextInput>(null);
    // Reads the text and the host's callback as they are when the request is taken; neither re-runs a request.
    useFocusRequest(
        focusRequested,
        () => {
            field.current?.focus();
            field.current?.setSelection(value.length, value.length);
            // `.focus()` raises the keyboard and moves nothing for VoiceOver or TalkBack (R7).
            moveScreenReaderFocus(field.current);
        },
        onFocusRequestHandled,
    );
    // R7: a list request opens the list as the request arrives. Adjusted during render from the previous request, so
    // the effect above only moves focus.
    const listWanted = focusRequested && listRequested;
    // Starts unseen: a request is a level, so a field that mounts while one stands opens its list too.
    const [seenListWanted, setSeenListWanted] = useState(false);

    if (listWanted !== seenListWanted) {
        setSeenListWanted(listWanted);

        if (listWanted) {
            setOpen(true);
        }
    }

    const optionCount = groups.reduce((count, group) => count + group.options.length, 0);
    const listShown = open && optionCount > 0;
    const popupShown = open && (optionCount > 0 || status !== undefined || trailingStatus.length > 0);
    const reveal = useContext(FieldRevealContext);
    // Reads the host's revealer as it is when the list opens; only the opening sends a request.
    const requestReveal = useEffectEvent((): (() => void) =>
        field.current === null ? RELEASE_NOTHING : reveal({ field: field.current, below: REVEAL_BELOW_DP }),
    );

    useEffect(() => (popupShown ? requestReveal() : undefined), [popupShown]);

    // A drag on the page closes the open list unless it began inside it: the list has no scroller of its own (item 7),
    // so a drag that begins on it scrolls the page under the finger and keeps it open. Whether the touch began inside is
    // tracked from the list's own touch events, in state.
    const subscribeDrag = useContext(ScrollerDragContext);
    const [touchInList, setTouchInList] = useState(false);
    const onPageDrag = useEffectEvent((): void => {
        if (!touchInList) {
            setOpen(false);
        }
    });

    useEffect(() => (popupShown ? subscribeDrag(() => onPageDrag()) : undefined), [popupShown, subscribeDrag]);

    const choose = (option: ComboboxOption): void => {
        if (option.busy === true) {
            return;
        }

        setOpen(false);
        onSelect(option.key);
    };

    const renderOption = (option: ComboboxOption) => (
        <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityLabel={option.accessibleName}
            aria-busy={option.busy === true}
            // React Native's own busy control is `disabled` (`@commise/ui/button`): it reads disabled, keeps its place,
            // and stays reachable by the screen reader.
            disabled={option.busy === true}
            onPress={() => {
                choose(option);
            }}
            style={({ pressed }) => [
                styles.option,
                pressed && { backgroundColor: wash },
                option.busy === true && styles.busy,
            ]}
        >
            <View style={styles.optionText}>
                <Text style={[styles.optionLabel, { color: colors.ink }]}>{option.label}</Text>
                {option.detailParts !== undefined && <VariantPartsLine parts={option.detailParts} tone="secondary" />}
            </View>
        </Pressable>
    );

    return (
        <View>
            <View style={styles.fieldRow}>
                {leadingIcon !== undefined && (
                    // Decorative: hidden from VoiceOver and TalkBack, as the field's name says what it does.
                    <View aria-hidden importantForAccessibility="no-hide-descendants" style={styles.leadingIcon}>
                        {leadingIcon}
                    </View>
                )}
                <TextInput
                    ref={field}
                    role="combobox"
                    accessibilityLabel={label}
                    accessibilityHint={hint}
                    aria-expanded={listShown}
                    aria-invalid={invalid || undefined}
                    autoCorrect={false}
                    placeholder={placeholder}
                    placeholderTextColor={colors.inkMuted}
                    value={value}
                    onChangeText={(text) => {
                        onValueChange(text);
                        setOpen(true);
                    }}
                    onFocus={() => {
                        onFocus?.();

                        if (closedByBlur.current && value !== '') {
                            setOpen(true);
                        }

                        closedByBlur.current = false;
                    }}
                    onBlur={() => {
                        closedByBlur.current = open;
                        setOpen(false);
                    }}
                    // The submit key chooses nothing: the keyboard and the list stay up, and the host says why.
                    submitBehavior="submit"
                    onSubmitEditing={() => {
                        onSubmitWithoutChoice?.();
                    }}
                    style={[styles.field, { borderBottomColor: colors.inkMuted, color: colors.ink }]}
                />
                {clear !== undefined && value !== '' && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={clear.label}
                        onPress={() => {
                            onValueChange('');
                        }}
                        style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: wash }]}
                    >
                        {clear.icon}
                    </Pressable>
                )}
                {cancel !== undefined && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={cancel.name}
                        onPress={cancel.onPress}
                        style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: wash }]}
                    >
                        <Text style={[styles.textButtonLabel, { color: colors.inkMuted }]}>{cancel.text}</Text>
                    </Pressable>
                )}
            </View>
            {belowField}
            <LiveRegion politeness="polite" visuallyHidden>
                {popupShown ? countAnnouncement : ''}
            </LiveRegion>
            <LiveRegion politeness="assertive" occurrence={alertOccurrence} visuallyHidden>
                {alertAnnouncement}
            </LiveRegion>
            {popupShown && (
                <View
                    collapsable={false}
                    accessibilityLabel={listLabel}
                    onTouchStart={() => setTouchInList(true)}
                    onTouchEnd={() => setTouchInList(false)}
                    onTouchCancel={() => setTouchInList(false)}
                    style={[styles.list, { backgroundColor: colors.paperOverlay }]}
                >
                    {status !== undefined && <StatusLine line={status} loadingIcon={loadingIcon} />}
                    {listShown &&
                        groups.map((group) => (
                            <View key={group.key}>
                                {group.label !== undefined && (
                                    <Text
                                        accessibilityRole="header"
                                        style={[styles.groupLabel, { color: colors.inkMuted }]}
                                    >
                                        {group.label}
                                    </Text>
                                )}
                                {group.options.map(renderOption)}
                            </View>
                        ))}
                    {trailingStatus.map((line, index) => (
                        // A line has no identity beyond its place: the host passes them in the order they arrived.
                        <StatusLine key={index} line={line} loadingIcon={loadingIcon} />
                    ))}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    fieldRow: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    field: {
        flex: 1,
        minWidth: 0,
        minHeight: TARGET_DP,
        borderBottomWidth: 1,
        // `inkMuted` (applied at render), not a divider: the underline says the field is editable, so it owes 3:1.
        paddingHorizontal: nativeTokens.spacing[1],
        fontSize: nativeTokens.fontSize.bodyMd,
    },
    list: {
        marginTop: LIST_MARGIN_DP,
        borderRadius: nativeTokens.radius.md,
        paddingVertical: LIST_PADDING_DP,
    },
    groupLabel: {
        paddingHorizontal: nativeTokens.spacing[3],
        paddingTop: nativeTokens.spacing[2],
        fontSize: nativeTokens.fontSize.caption,
        fontWeight: '600',
    },
    iconButton: { minWidth: TARGET_DP, minHeight: TARGET_DP, alignItems: 'center', justifyContent: 'center' },
    leadingIcon: { flexShrink: 0 },
    textButton: {
        minWidth: TARGET_DP,
        minHeight: TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.full,
    },
    textButtonLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500' },
    option: {
        minHeight: TARGET_DP,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[1],
    },
    // `minWidth: 0`: a column that cannot shrink below its parts line is how a dot came to start a line.
    optionText: { flex: 1, minWidth: 0 },
    busy: { opacity: 0.6 },
    optionLabel: { fontSize: nativeTokens.fontSize.bodyMd },
    status: {
        gap: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    statusText: { fontSize: nativeTokens.fontSize.bodySm },
    loadingLine: { flexDirection: 'row', alignItems: 'center' },
    // `minWidth: 0` and `flexShrink: 1`: the label wraps beside its glyph rather than pushing the row past 320 px.
    loadingLabel: { flexShrink: 1, minWidth: 0 },
});
