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
 *   own, the list scrolls with the page under the finger. A `touchcancel` does not end that touch: it is how the
 *   scroller announces that it took the gesture (below). A host may bound a long list (`listMaxRows`,
 *   `docs/design/uiOverhaul/cuisineField.md` §4 P2): its options then sit in a nested scroller, still in the page's flow,
 *   and a drag that began on it scrolls the list instead.
 * - `typedText="isValue"` (P1): the typed text is the value, so the return key reads Done and ends the entry, a pick
 *   dismisses the keyboard, and the keyboard hiding while the field has focus closes the list.
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
 * The field is the house text field (`docs/design/uiOverhaul/buildSpec.md` §7.4): a visible `FieldLabel` above it, which
 * focuses the field when pressed, with the hint under the label, and the shared rectangle geometry (`fieldStyle.ts`),
 * not an underline. The leading glyph sits inside the rectangle.
 *
 * - An ARRIVAL (`ComboboxProps.arrival`, `docs/design/uiOverhaul/ingredientArrival.md`): a row that arrived straight above
 *   the field is shown with it. The leaf asks the same host once per arrival key, with the dp from the row's top to the
 *   field's top (the row's, plus where the field's row sits in the combobox, as laid out), and releases the ask when
 *   the key goes.
 *
 * One ref, for what has no declarative form: the field, for `.focus()` and the caret on a host's focus request, and as
 * the node a reveal request hands the host to measure.
 *
 * @pattern Adapter over TextInput
 * @pattern Adapter over the React Native focus API — a level-triggered focus request, acknowledged once taken
 */
import { useContext, useEffect, useEffectEvent, useRef, useState, type FC, type ReactNode } from 'react';
import {
    Keyboard,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
    type TextInput as NativeTextInput,
} from 'react-native';

import { FieldRevealContext } from '../fieldReveal/fieldRevealContext.js';
import { ScrollerDragContext } from '../fieldReveal/scrollerDrag.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { FIELD_PADDING, fieldGeometry, fieldPaint } from '../input/fieldStyle.js';
import { FieldLabel } from '../input/FieldLabel.native.js';
import { fieldAccessibilityHint } from '../input/props.js';
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

/** The share of the window a bounded list may take at most (`cuisineField.md` §4 P2). */
const BOUNDED_LIST_WINDOW_SHARE = 0.45;

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
    id,
    label,
    labelVisibility = 'visible',
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
    trailingAction,
    clear,
    leadingIcon,
    hint,
    belowField,
    invalid = false,
    error,
    focusRequested = false,
    onFocusRequestHandled,
    listRequested = false,
    openOnFocus = false,
    alertOccurrence,
    typedText = 'needsChoice',
    onBlur,
    listMaxRows,
    arrival,
}) => {
    const [open, setOpen] = useState(false);
    // Whether the field has focus: under `isValue` the keyboard hiding while it does closes the list (P1).
    const [focused, setFocused] = useState(false);
    const typedIsValue = typedText === 'isValue';
    const { height: windowHeight, fontScale } = useWindowDimensions();
    const theme = useTheme();
    const { colors, wash } = theme;
    const labelShown = labelVisibility === 'visible';
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
        field.current === null
            ? RELEASE_NOTHING
            : reveal({ field: field.current, below: REVEAL_BELOW_DP, kind: 'list', above: 0 }),
    );

    useEffect(() => (popupShown ? requestReveal() : undefined), [popupShown]);

    // Where the field's row sits in the combobox, as laid out (under the label, its hint and the root's gap; 0 with no
    // label): the host measures the FIELD, and an arrival's row sits above the whole combobox, so the span from the row
    // to the field adds it. Read from the row's own layout, so the root's gap has one authority (`styles.root`).
    const [fieldRowTop, setFieldRowTop] = useState(0);
    // One ask per arrival key. Reads the row's height as it is when the key arrives: a row that grows later asks nothing.
    const requestArrival = useEffectEvent((): (() => void) =>
        field.current === null || arrival === undefined
            ? RELEASE_NOTHING
            : reveal({
                  field: field.current,
                  below: 0,
                  kind: 'arrival',
                  above: arrival.aboveDp + fieldRowTop,
              }),
    );
    const arrivalKey = arrival?.key;

    useEffect(() => (arrivalKey === undefined ? undefined : requestArrival()), [arrivalKey]);

    // A drag on the page closes the open list unless it began inside it. Whether the touch began inside is tracked
    // from the list's own touch events, in state: set on its start, and spent by the one drag it began. Who ends the
    // touch depends on the list. Unbounded, it has no scroller of its own (item 7): a drag that begins on it scrolls the
    // page under the finger, keeps it open, and the touch ends on the list (`onTouchEnd`) or the page drag spends the
    // flag. Bounded (`listMaxRows`), a nested scroller takes the gesture: JS gets a cancel and no `touchend`, and the
    // scroller's begin-drag is a direct event the page's drag host never hears, so the scroller ends its own drag
    // (`onScrollEndDrag`: the END, so a hand-off to the page mid-gesture still finds the flag set).
    //
    // ⛔ A `touchcancel` does not clear it. The scroller TAKING the gesture is what cancels the list's touch, and on
    // Android the cancel arrives BEFORE the drag's start (`ReactScrollView.handleInterceptedTouchEvent` calls
    // `NativeGestureUtil.notifyNativeGestureStarted`, a cancel to JS, then `emitScrollBeginDragEvent`). Neither order
    // may matter. A cancel no drag follows leaves the flag set until the next drag, which then keeps the list open once.
    const subscribeDrag = useContext(ScrollerDragContext);
    const [touchInList, setTouchInList] = useState(false);
    const onPageDrag = useEffectEvent((): void => {
        if (touchInList) {
            setTouchInList(false);
        } else {
            setOpen(false);
        }
    });

    useEffect(() => (popupShown ? subscribeDrag(() => onPageDrag()) : undefined), [popupShown, subscribeDrag]);

    // @sideEffect Under `isValue`, the keyboard hiding while the field has focus closes the list: React Native does not
    // blur a `TextInput` when Android Back dismisses the keyboard, so the list would otherwise stay up with no keyboard
    // (`cuisineField.md` §3.2). A field that needs a choice keeps its list, as before.
    useEffect(() => {
        if (!typedIsValue || !focused) {
            return undefined;
        }

        const subscription = Keyboard.addListener('keyboardDidHide', () => {
            setOpen(false);
        });

        return () => {
            subscription.remove();
        };
    }, [typedIsValue, focused]);

    const choose = (option: ComboboxOption): void => {
        if (option.busy === true) {
            return;
        }

        setOpen(false);

        // A pick of a value the typed text could also have been is the end of the entry: the keyboard goes too (P1).
        // ⛔ BEFORE `onSelect`: dismissing blurs the field, and a blur can report synchronously (react-native-web) with
        // the host's handlers still holding the text as typed. Dismissing first lets the pick be the last word.
        if (typedIsValue) {
            Keyboard.dismiss();
        }

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

    const renderGroups = () =>
        groups.map((group) => (
            <View key={group.key}>
                {group.label !== undefined && (
                    <Text accessibilityRole="header" style={[styles.groupLabel, { color: colors.inkMuted }]}>
                        {group.label}
                    </Text>
                )}
                {group.options.map(renderOption)}
            </View>
        ));

    // P2: `listMaxRows + 0.5` rows at the current font scale (the half row shows the list scrolls), never past 45% of
    // the window; only when there are more options than the bound.
    const boundedHeight =
        listMaxRows !== undefined && optionCount > listMaxRows
            ? Math.min((listMaxRows + 0.5) * TARGET_DP * fontScale, windowHeight * BOUNDED_LIST_WINDOW_SHARE)
            : undefined;

    return (
        <View style={styles.root}>
            {labelShown && <FieldLabel forId={id} label={label} {...(hint === undefined ? {} : { hint })} />}
            <View
                collapsable={false}
                style={styles.fieldRow}
                onLayout={(event) => setFieldRowTop(event.nativeEvent.layout.y)}
            >
                <View style={styles.fieldBox}>
                    {leadingIcon !== undefined && (
                        // Decorative: hidden from VoiceOver and TalkBack, as the field's name says what it does.
                        <View aria-hidden importantForAccessibility="no-hide-descendants" style={styles.leadingIcon}>
                            {leadingIcon}
                        </View>
                    )}
                    <TextInput
                        ref={field}
                        nativeID={id}
                        role="combobox"
                        accessibilityLabel={label}
                        // React Native has no `aria-describedby`, so the hint a screen reader speaks on focus is the
                        // field's own, drawn caption or not. The caption is for sighted users; a screen reader meets
                        // it as a text node beside the label, and hears the hint again here.
                        // The error leads it, because it is the news: React Native 0.86 has no `aria-invalid` or invalid
                        // state either, so the danger edge and this hint are all a screen reader gets (P4).
                        accessibilityHint={fieldAccessibilityHint(error, hint)}
                        aria-expanded={listShown}
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
                            setFocused(true);

                            if (openOnFocus || (closedByBlur.current && value !== '')) {
                                setOpen(true);
                            }

                            closedByBlur.current = false;
                        }}
                        onBlur={() => {
                            closedByBlur.current = open;
                            setOpen(false);
                            setFocused(false);
                            onBlur?.();
                        }}
                        // The submit key chooses nothing. A field that needs a choice keeps the keyboard and the list up,
                        // and the host says why; a field whose typed text is the value is done (P1): Done, then both go.
                        submitBehavior={typedIsValue ? 'blurAndSubmit' : 'submit'}
                        {...(typedIsValue ? { enterKeyHint: 'done' as const } : {})}
                        onSubmitEditing={() => {
                            onSubmitWithoutChoice?.();

                            if (typedIsValue) {
                                setOpen(false);
                                Keyboard.dismiss();
                            }
                        }}
                        style={[
                            styles.field,
                            fieldPaint(theme, invalid || error !== undefined),
                            leadingIcon === undefined ? null : styles.fieldWithIcon,
                        ]}
                    />
                </View>
                {trailingAction}
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
            {/* Plain text, no role and no live region: the hint above carries it to the screen reader, and a host that
                must speak it uses `alertAnnouncement`. */}
            {error !== undefined && <Text style={[styles.error, { color: colors.dangerText }]}>{error}</Text>}
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
                    style={[styles.list, { backgroundColor: colors.paperOverlay }]}
                >
                    {status !== undefined && <StatusLine line={status} loadingIcon={loadingIcon} />}
                    {listShown &&
                        (boundedHeight === undefined ? (
                            renderGroups()
                        ) : (
                            // P2: a long list scrolls inside itself, so the rest of the page stays in reach. It stays in
                            // the page's flow, so nothing is drawn outside its parent (Android takes no touches there),
                            // and a drag that began on it still keeps it open — the drag now scrolls the list.
                            <ScrollView
                                nestedScrollEnabled
                                keyboardShouldPersistTaps="handled"
                                onScrollEndDrag={() => setTouchInList(false)}
                                style={{ maxHeight: boundedHeight }}
                            >
                                {renderGroups()}
                            </ScrollView>
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

/** Where the text starts when a glyph sits inside the rectangle: the padding, the 16 dp glyph and a gap. */
const TEXT_START_WITH_ICON_DP = FIELD_PADDING + 16 + nativeTokens.spacing[2];

const styles = StyleSheet.create({
    root: { gap: nativeTokens.spacing[1] },
    fieldRow: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    fieldBox: { flex: 1, minWidth: 0, justifyContent: 'center' },
    // The shared rectangle (`fieldGeometry`: 12 radius, 1 dp edge, 48 tall). Colour is painted at render.
    field: { ...fieldGeometry, flex: 1, minWidth: 0 },
    fieldWithIcon: { paddingStart: TEXT_START_WITH_ICON_DP },
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
    leadingIcon: { position: 'absolute', start: FIELD_PADDING, zIndex: 1 },
    textButton: {
        minWidth: TARGET_DP,
        minHeight: TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.full,
    },
    error: nativeTokens.type.label,
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
