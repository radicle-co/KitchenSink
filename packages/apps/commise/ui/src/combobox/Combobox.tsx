'use client';

/**
 * @module @commise/ui/combobox — the web `Combobox`: a text field with a list of suggestions below it, chosen
 * explicitly (`docs/design/ingredientStatusExplanation.md` §2a, §3, §8d). A presentational design-system primitive:
 * the host owns the text and the suggestions, and this leaf holds only whether the list shows and which option is
 * active.
 *
 * downshift `useCombobox` owns the APG behaviour (roles and states, the keys, the active descendant, scrolling the
 * active option into view, an outside press), and `@floating-ui/react-dom` places the list
 * (`docs/design/rowEditorOpenDecisions.md` V3-1, V3-2): below the field, or above it when its full height fits only
 * there, or on the side with more room when it fits on neither; as wide as the field, or 20rem when the field is
 * narrower (the width `@commise/ui/popover` takes); sliding along the viewport's edge rather than narrowing; and never
 * over the page's own fixed or sticky chrome, which the page reports through `@commise/ui/popup-insets`. Where this
 * leaf departs from downshift's defaults (`docs/design/rowEditorBlueprint.md` decision 3):
 *
 * - ⛔ Only a press, or Enter on the active option, chooses (3.2.2): never Tab or leaving the field, never Enter with
 *   nothing active, never a busy option, and never while an input method is composing.
 * - ⛔ The text is the host's alone: the field forwards what the cook types in the change event itself, and downshift
 *   never rewrites it, so a selection or an Escape never changes it behind the host and the caret stays where the
 *   cook is typing.
 * - Enter never submits the form around the field; Escape on a closed list abandons the entry through the host, or is
 *   left to the page when the host takes no abandon; Home and End move the caret (§3e); a press in the field moves the
 *   caret and leaves the list as it is.
 * - The active option is held by its KEY, so a list that changes under the cook keeps it or drops it, and never moves
 *   the highlight onto another option.
 * - One polite and one assertive region, both mounted before their text changes (4.1.3). The polite one speaks only
 *   while the popup shows (`ComboboxProps.countAnnouncement`); the assertive one is never held back. The status lines
 *   are shown and never live, so nothing is spoken twice.
 * - The popup reads the status line, then the listbox, then the trailing lines in the host's order (1.3.2;
 *   `docs/design/rowEditorOpenDecisions.md` R1, system change 11). The lines sit outside the listbox, whose children
 *   may only be options and groups, and the listbox is never `aria-busy` (S7 list contract P2). A search in flight is
 *   one still line, a glyph and its label, never placeholder rows (P3).
 * - The popup chooses its side once per text, from a first render at a fixed full height that is invisible, and keeps
 *   it while that text's list grows; above its field it takes its full height at once, so arriving content never moves
 *   an option (P9, V3-1).
 * - The status lines never squeeze the list: the listbox keeps a floor of up to three option rows, and the popup's card
 *   scrolls when the lines and that floor are taller than it (1.4.4, V3-3). The active option scrolls into view in the
 *   card as well as in the listbox.
 * - An option shows its label and its variant's parts, all presentation: an option holds no control (APG). The active
 *   option takes the `surfaceMuted` fill (linen since D11; it was pearl) and the `selectedEdge` ring the details
 *   dialog's active row takes (V3-4).
 * - The web field has no clear button: Escape on a closed list clears it, through the host.
 * - A touch drag on the page outside the open list closes it; a drag inside it scrolls the list, whose card contains its
 *   own scroll, so the page under it stays put.
 * - ⛔ No transition classes, so `prefers-reduced-motion` has nothing to suppress.
 *
 * A host's focus request needs the field's node, for `.focus()` and the caret, which have no declarative form. It is
 * floating-ui's reference node, which floating-ui holds in state, so this leaf holds no ref of its own.
 *
 * @pattern Adapter over downshift useCombobox
 * @pattern Adapter over @floating-ui/react-dom
 * @pattern Decorator over floating-ui's DOM platform — its clipping rect, less the page's chrome
 * @pattern Adapter over the DOM focus API — a level-triggered focus request, acknowledged once taken
 */
import {
    autoUpdate,
    flip,
    offset,
    platform,
    shift,
    size,
    useFloating,
    type Middleware,
    type Placement,
    type Platform,
} from '@floating-ui/react-dom';
import { compute } from 'compute-scroll-into-view';
import { useCombobox, type UseComboboxState, type UseComboboxStateChangeOptions } from 'downshift';
import {
    Fragment,
    useContext,
    useEffect,
    useEffectEvent,
    useId,
    useState,
    type FC,
    type KeyboardEvent,
    type ReactNode,
} from 'react';

import { BUSY_CONTROL_CLASS } from '../button/busyControlProps.js';
import { LiveRegion } from '../liveRegion/LiveRegion.js';
import { PopupInsetsContext, type PopupInsetsReader } from '../popupInsets/popupInsetsContext.js';
import { VariantPartsLine } from '../variantPartsLine/VariantPartsLine.js';
import type { ComboboxOption, ComboboxProps, ComboboxStatus } from './props.js';

/** The keys that move the caret: §3e gives Home and End to the field, and APG returns visual focus to it on all four. */
const CARET_KEYS: ReadonlySet<string> = new Set(['Home', 'End', 'ArrowLeft', 'ArrowRight']);

/** The key code a browser reports for a key the input method is handling. */
const IME_KEY_CODE = 229;

/** The space the list keeps from its field and from the viewport's edge, as `@commise/ui/popover` keeps. */
const LIST_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The space the popup may take, as properties its classes read: the room on its side, its field's width, and the room
 * across the viewport. `shift` is on, so floating-ui reports the viewport's whole width as that room (V3-2).
 */
const SIZE_TO_SPACE = size({
    padding: VIEWPORT_MARGIN_PX,
    apply: ({ availableHeight, availableWidth, rects, elements }) => {
        const { style } = elements.floating;

        style.setProperty('--combobox-available-height', `${Math.max(0, availableHeight)}px`);
        style.setProperty('--combobox-available-width', `${Math.max(0, availableWidth)}px`);
        style.setProperty('--combobox-reference-width', `${rects.reference.width}px`);
    },
});

/** Near the viewport's edge the popup slides along it and keeps its width (V3-2). */
const SLIDE = shift({ padding: VIEWPORT_MARGIN_PX });

/**
 * For a new text: below the field, or above it. `flip` decides the side alone, and `shift` owns the other axis, so a
 * popup near the right edge slides instead of taking the field's other alignment as its side.
 */
const CHOOSE_SIDE = [
    offset(LIST_GAP_PX),
    flip({ padding: VIEWPORT_MARGIN_PX, crossAxis: false, flipAlignment: false }),
    SLIDE,
    SIZE_TO_SPACE,
];

/** For a text whose side is chosen: that side, whatever the list grows to (`rowEditorOpenDecisions.md` P9). */
const KEEP_SIDE = [offset(LIST_GAP_PX), SLIDE, SIZE_TO_SPACE];

/**
 * The popup's first render for a text, at a fixed full height and invisible: the side is chosen at this height, never
 * at what the list holds yet (V3-1). Fixed, because `--combobox-available-height` still holds the room of the side
 * the last text took, and a probe that read it would always fit there.
 */
const HEIGHT_PROBE = 'invisible h-[min(20rem,calc(100dvh-1rem))]';

/** The popup's height: the space it has, at once, when above its field; up to that space when below (P9). */
const HEIGHT_ABOVE = 'h-[min(20rem,var(--combobox-available-height,20rem))]';
const HEIGHT_BELOW = 'max-h-[min(20rem,var(--combobox-available-height,20rem))]';

/**
 * The popup's width: its field's, or `@commise/ui/popover`'s 20rem when the field is narrower, and never more than the
 * viewport less its margins. A field its row squeezes would otherwise give a list whose first line wraps a word a line.
 */
const POPUP_WIDTH = 'w-[max(var(--combobox-reference-width),min(20rem,var(--combobox-available-width)))]';

/**
 * The listbox's floor: up to three option rows, each `min-h-11` as an option is, so status lines never squeeze the
 * options away (V3-3). Pure.
 *
 * @param count - The options the listbox holds, one or more.
 * @returns The floor's class.
 */
const listboxFloorOf = (count: number): string => {
    if (count >= 3) {
        return 'min-h-33';
    }

    return count === 2 ? 'min-h-22' : 'min-h-11';
};

/**
 * floating-ui's DOM platform with the page's own chrome taken off the clipping rect. Every middleware that measures
 * overflow (`flip`, `shift`, `size`) reads that rect, so each keeps its margin clear of the chrome too. The reader is
 * called at each placement: floating-ui reads the platform it was last given, while it keeps a middleware's
 * derivable options from the render that first passed them. Pure.
 *
 * @param readInsets - The page's chrome, read when the popup is placed.
 * @returns The platform.
 */
const platformClearOf = (readInsets: PopupInsetsReader): Platform => ({
    ...platform,
    async getClippingRect(args) {
        // Called on the platform floating-ui places with, which carries that placement's cache as `this`.
        const rect = await platform.getClippingRect.call(this, args);
        const { top, bottom } = readInsets();

        return { ...rect, y: rect.y + top, height: Math.max(0, rect.height - top - bottom) };
    },
});

/** The side the popup took for one text. */
interface ChosenSide {
    readonly text: string;
    readonly placement: Placement;
}

/** The name {@link stampText} records under in floating-ui's middleware data. */
const STAMP = 'comboboxText';

/**
 * A middleware that records which text a placement was computed for, so the side is taken from a placement of THIS
 * text and never from the one before it. Its `options` carry the text, so a new text is a new computation.
 */
const stampText = (text: string): Middleware => ({
    name: STAMP,
    options: text,
    fn: () => ({ data: { text } }),
});

/**
 * One status line, drawn still: a `loading` line is the host's glyph and its label, a note its text. Pure.
 *
 * @param line - The line.
 * @param loadingIcon - The glyph a `loading` line shows.
 * @returns The line's element.
 */
const statusLine = (line: ComboboxStatus, loadingIcon: ReactNode): ReactNode =>
    line.kind === 'loading' ? (
        <p className="flex shrink-0 items-center gap-2 px-3 py-2 text-body-sm text-ink-muted">
            {loadingIcon !== undefined && (
                <span aria-hidden className="inline-flex shrink-0">
                    {loadingIcon}
                </span>
            )}
            <span className="min-w-0 break-words">{line.label}</span>
        </p>
    ) : (
        <p className="shrink-0 break-words px-3 py-2 text-body-sm text-ink-muted">{line.text}</p>
    );

/**
 * downshift's `scrollIntoView` hook (V3-3): the active option scrolls whole into view in the listbox, then in the card
 * that holds it, and nothing above the card scrolls. downshift's own stops at the listbox, which a card shorter than
 * the listbox's floor cuts (`docs/design/v3Evaluation.md` V3-M2a). `always`, because `if-needed` returns at the first
 * frame that shows the option (`compute-scroll-into-view` 3.1.1, `src/index.ts:390`), and the card does not cut the
 * listbox's box; `nearest` leaves a frame that already shows the whole option alone. The card is the listbox's parent
 * (the markup below), read when downshift calls this, so the hook closes over nothing from a render.
 *
 * @param option - The active option.
 * @param listbox - The listbox, downshift's menu node.
 * @sideEffect Sets `scrollTop` and `scrollLeft` on the listbox and the card.
 */
const scrollIntoCard = (option: HTMLElement, listbox: HTMLElement): void => {
    for (const { el, top, left } of compute(option, {
        boundary: listbox.parentElement ?? listbox,
        block: 'nearest',
        scrollMode: 'always',
    })) {
        el.scrollTop = top;
        el.scrollLeft = left;
    }
};

/** A key press downshift reads `preventDownshiftDefault` from. */
type FieldKeyDown = KeyboardEvent<HTMLInputElement> & { preventDownshiftDefault?: boolean };

/**
 * Whether a commit landed on an option that may be chosen: an option, and not one whose work is in flight. Pure.
 *
 * @param option - The option the commit names, if any.
 * @returns Whether it may be chosen.
 */
const isChoosable = (option: ComboboxOption | null | undefined): option is ComboboxOption =>
    option !== undefined && option !== null && option.busy !== true;

/**
 * Where the combobox departs from downshift's state transitions. Pure.
 *
 * Only a commit — a press, or Enter on the active option — chooses, and a commit of nothing or of a busy option changes
 * nothing at all, so the list stays as it is. Every other transition keeps the selection, which is how Tab, leaving the
 * field and Alt+Up choose nothing. A press in the field leaves the list as it is.
 *
 * @param state - The current state.
 * @param actionAndChanges - The transition and downshift's own changes for it.
 * @returns The changes to apply.
 */
const reduceComboboxState = (
    state: UseComboboxState<ComboboxOption>,
    { type, changes }: UseComboboxStateChangeOptions<ComboboxOption>,
): Partial<UseComboboxState<ComboboxOption>> => {
    switch (type) {
        case useCombobox.stateChangeTypes.InputClick:
            return state;

        case useCombobox.stateChangeTypes.ItemClick:
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
            return isChoosable(changes.selectedItem) ? changes : state;

        default:
            return { ...changes, selectedItem: state.selectedItem };
    }
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
    onAbandon,
    cancel,
    leadingIcon,
    hint,
    belowField,
    invalid = false,
    describedBy,
    focusRequested = false,
    onFocusRequestHandled,
    listRequested = false,
    alertOccurrence,
}) => {
    const hintId = useId();
    const readInsets = useContext(PopupInsetsContext);
    const [activeKey, setActiveKey] = useState<string | undefined>(undefined);

    const options = groups.flatMap((group) => group.options);
    const activeIndex = options.findIndex((option) => option.key === activeKey);
    const keyAt = (index: number): string | undefined =>
        index >= 0 && index < options.length ? options[index].key : undefined;

    const { isOpen, getInputProps, getMenuProps, getItemProps, openMenu, closeMenu } = useCombobox<ComboboxOption>({
        items: options,
        itemToString: (option) => option?.label ?? '',
        inputValue: value,
        // Never holds a choice, so choosing the same option again is a change downshift reports again.
        selectedItem: null,
        highlightedIndex: activeIndex,
        stateReducer: reduceComboboxState,
        scrollIntoView: scrollIntoCard,
        onHighlightedIndexChange: ({ highlightedIndex }) => {
            setActiveKey(keyAt(highlightedIndex));
        },
        onIsOpenChange: ({ isOpen: open }) => {
            if (!open) {
                setActiveKey(undefined);
            }
        },
        onSelectedItemChange: ({ selectedItem }) => {
            if (selectedItem !== null && selectedItem !== undefined) {
                onSelect(selectedItem.key);
            }
        },
    });

    const listShown = isOpen && options.length > 0;
    const popupShown = isOpen && (options.length > 0 || status !== undefined || trailingStatus.length > 0);
    // The side the popup took for the text it shows: kept while that text's list grows, chosen again for a new text.
    const [chosenSide, setChosenSide] = useState<ChosenSide | undefined>(undefined);
    const keptPlacement = chosenSide?.text === value ? chosenSide.placement : undefined;

    const {
        refs: { setReference, setFloating },
        elements,
        floatingStyles,
        placement,
        isPositioned,
        middlewareData,
    } = useFloating<HTMLInputElement>({
        open: popupShown,
        placement: keptPlacement ?? 'bottom-start',
        strategy: 'fixed',
        middleware: [...(keptPlacement === undefined ? CHOOSE_SIDE : KEEP_SIDE), stampText(value)],
        platform: platformClearOf(readInsets),
        whileElementsMounted: autoUpdate,
    });
    const fieldNode = elements.reference;
    const stamp: unknown = middlewareData[STAMP]?.text;

    // The first placement computed for a text is its side. Adjusted during render, React's previous-value form.
    if (popupShown && isPositioned && keptPlacement === undefined && stamp === value) {
        setChosenSide({ text: value, placement });
    }

    const popupHeightClass =
        keptPlacement === undefined ? HEIGHT_PROBE : keptPlacement.startsWith('top') ? HEIGHT_ABOVE : HEIGHT_BELOW;

    const floatingNode = elements.floating;

    // @sideEffect While the list shows, a touch drag on the page outside it and its field closes it: the popup is fixed,
    // so it would float over content the cook has moved on to. A drag inside it scrolls the list, which keeps its scroll
    // (`overscroll-contain`). downshift itself ignores a touch that moved, which is right for a tap and not for a drag.
    useEffect(() => {
        if (!popupShown) {
            return undefined;
        }

        const onTouchMove = (event: TouchEvent): void => {
            const target = event.target;
            const inside =
                target instanceof Node &&
                ((floatingNode?.contains(target) ?? false) || (fieldNode?.contains(target) ?? false));

            if (!inside) {
                closeMenu();
            }
        };

        document.addEventListener('touchmove', onTouchMove, { passive: true });

        return () => document.removeEventListener('touchmove', onTouchMove);
    }, [popupShown, floatingNode, fieldNode, closeMenu]);

    // Reads the host's callback and list request as they are when the request is taken; neither re-runs a request.
    const takeFocusRequest = useEffectEvent((node: HTMLInputElement) => {
        node.focus();
        node.setSelectionRange(node.value.length, node.value.length);

        if (listRequested) {
            openMenu();
        }

        onFocusRequestHandled?.();
    });

    useEffect(() => {
        if (focusRequested && fieldNode !== null) {
            takeFocusRequest(fieldNode);
        }
    }, [focusRequested, fieldNode]);

    const onKeyDown = (event: FieldKeyDown): void => {
        if (event.nativeEvent.isComposing) {
            // The input method owns every key while it composes.
            event.preventDownshiftDefault = true;

            return;
        }

        if (CARET_KEYS.has(event.key)) {
            event.preventDownshiftDefault = true;
            setActiveKey(undefined);

            return;
        }

        if (event.key === 'Escape' && !isOpen) {
            event.preventDownshiftDefault = true;

            if (onAbandon !== undefined) {
                event.preventDefault();
                onAbandon();
            }

            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();

            // Safari reports the Enter that ends a composition as keyCode 229 after `compositionend`: the input
            // method's, not a submit.
            if ((activeIndex < 0 || !isOpen) && event.nativeEvent.keyCode !== IME_KEY_CODE) {
                onSubmitWithoutChoice?.();
            }
        }
    };

    const describedByIds = [
        ...(hint === undefined ? [] : [hintId]),
        ...(describedBy === undefined ? [] : [describedBy]),
    ];

    const inputProps = getInputProps({
        ref: setReference,
        'aria-label': label,
        'aria-describedby': describedByIds.length === 0 ? undefined : describedByIds.join(' '),
        'aria-invalid': invalid || undefined,
        type: 'text',
        placeholder,
        onFocus,
        onKeyDown,
        onChange: (event) => {
            onValueChange(event.currentTarget.value);
            setActiveKey(undefined);
        },
        className:
            'min-w-0 flex-1 border-b border-line-control bg-transparent px-1 py-2 text-body-md text-ink outline-none placeholder:text-ink-muted focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring',
    });
    const activeDescendant = inputProps['aria-activedescendant'];
    // The listbox mounts only while it has options; downshift is told so, and checks its ref only when it does.
    const menuProps = getMenuProps(
        { 'aria-label': listLabel, className: `flex ${listboxFloorOf(options.length)} flex-col overflow-y-auto` },
        { suppressRefError: true },
    );

    const renderOption = (option: ComboboxOption) => (
        <li
            key={option.key}
            {...getItemProps({
                item: option,
                'aria-label': option.accessibleName,
                'aria-disabled': option.busy === true || undefined,
                'aria-busy': option.busy === true || undefined,
                className: `flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-1 aria-selected:bg-surface-muted aria-selected:ring-2 aria-selected:ring-inset aria-selected:ring-selected-edge ${BUSY_CONTROL_CLASS}`,
            })}
        >
            {/* `min-w-0`: a column that cannot shrink below its parts line is how a dot came to start a line. */}
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words text-body-md text-ink">{option.label}</span>
                {option.detailParts !== undefined && <VariantPartsLine parts={option.detailParts} tone="secondary" />}
            </span>
        </li>
    );

    return (
        <div>
            <div className="flex items-center gap-2">
                {leadingIcon !== undefined && (
                    <span aria-hidden className="inline-flex shrink-0 text-ink-muted">
                        {leadingIcon}
                    </span>
                )}
                <input
                    {...inputProps}
                    aria-expanded={listShown}
                    aria-controls={listShown ? inputProps['aria-controls'] : undefined}
                    aria-activedescendant={activeDescendant === '' ? undefined : activeDescendant}
                />
                {cancel !== undefined && (
                    <button
                        type="button"
                        aria-label={cancel.name}
                        onClick={cancel.onPress}
                        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-3 text-body-sm font-medium text-ink-muted hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        {cancel.text}
                    </button>
                )}
            </div>
            {belowField}
            {hint !== undefined && (
                <span id={hintId} className="sr-only">
                    {hint}
                </span>
            )}
            <span aria-live="polite" className="sr-only">
                {popupShown ? countAnnouncement : ''}
            </span>
            <LiveRegion politeness="assertive" occurrence={alertOccurrence} visuallyHidden>
                {alertAnnouncement}
            </LiveRegion>
            {popupShown && (
                <div
                    ref={setFloating}
                    style={floatingStyles}
                    className={`z-50 flex ${popupHeightClass} ${POPUP_WIDTH} flex-col overflow-y-auto overscroll-contain rounded-2xl bg-paper-overlay p-1 shadow-lg`}
                >
                    {status !== undefined && statusLine(status, loadingIcon)}
                    {listShown && (
                        <ul {...menuProps}>
                            {groups.map((group) =>
                                group.label === undefined ? (
                                    group.options.map(renderOption)
                                ) : (
                                    <li key={group.key} role="presentation">
                                        <ul role="group" aria-label={group.label} className="flex flex-col">
                                            <li
                                                role="presentation"
                                                aria-hidden
                                                className="px-3 pt-2 text-caption font-semibold text-ink-muted"
                                            >
                                                {group.label}
                                            </li>
                                            {group.options.map(renderOption)}
                                        </ul>
                                    </li>
                                ),
                            )}
                        </ul>
                    )}
                    {trailingStatus.map((line, index) => (
                        // A line has no identity beyond its place: the host passes them in the order they arrived.
                        <Fragment key={index}>{statusLine(line, loadingIcon)}</Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};
