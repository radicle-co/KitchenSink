/**
 * @module @commise/ui/field-reveal — how a native field asks the scroller around it to show the field and what opens
 * below it (`docs/design/rowEditorOpenDecisions.md` E1, item 7 condition 2). The native sibling of `PopupInsets`.
 *
 * A field cannot see the scroller it sits in, and the scroller cannot see the fields inside it, so the scroller's host
 * publishes a REVEALER: a function the field calls when its list opens. The field says how much room it needs below it;
 * the host decides whether to scroll. A screen that provides no revealer gets the default, which does nothing.
 *
 * @pattern Dependency Injection through a React context — the host provides the revealer, the field consumes it, and
 *     neither imports the other
 * @pattern Null Object — the default revealer asks nothing and releases nothing
 */
import { createContext } from 'react';
import type { HostInstance } from 'react-native';

/** The field the host measures: only `measureLayout` is read. */
export type RevealTarget = Pick<HostInstance, 'measureLayout'>;

/**
 * One request to the scroller around a field. The kinds share a field and nothing else, so each carries only what it
 * needs (`docs/design/uiOverhaul/specSharedSystem.md` §16.3).
 *
 * - A `list` is the field and the list that opened below it, shown by laying out blank space and scrolling the field
 *   to the top. `below` is the dp the field needs below it, from its own layout constants (the list's margin, padding
 *   and rows).
 * - An `arrival` is a row that just arrived straight above the field, shown with the field by the smallest scroll, and
 *   never with blank space (`docs/design/uiOverhaul/ingredientArrival.md`). `above` is the dp from the top of the row
 *   that arrived to the top of the field.
 * - A `focus` is a field the cook is typing in: the host keeps it inside the visible area for as long as it is held,
 *   and checks again each time the visible area gets shorter (the keyboard rising, then the pinned footer).
 * - A `target` is a field a refused Publish named: the host scrolls it to the middle of the visible area, once, and
 *   then calls `onShown`, where the field moves the screen-reader cursor to itself.
 *
 * @notWireShape a field's in-process request to the scroller around it; never serialised or sent anywhere
 */
export type RevealRequest =
    | { readonly kind: 'list'; readonly field: RevealTarget; readonly below: number }
    | { readonly kind: 'arrival'; readonly field: RevealTarget; readonly above: number }
    | { readonly kind: 'focus'; readonly field: RevealTarget }
    | { readonly kind: 'target'; readonly field: RevealTarget; readonly onShown: () => void };

/** The request of a field's list: the one kind the opening's reducer holds. */
export type ListRequest = Extract<RevealRequest, { readonly kind: 'list' }>;

/** Ask the host to show the field and the room below it. Called from an effect, never in render; returns the release. */
export type FieldRevealer = (request: RevealRequest) => () => void;

/** Releases nothing. */
const RELEASE_NOTHING = (): void => undefined;

/**
 * The revealer of a field no scroller can show: it asks nothing and releases nothing. A `target` still hears that it was
 * shown, at once: a field under a `Modal` has no host to scroll it, and would otherwise never get the screen-reader cursor.
 */
export const revealNothing: FieldRevealer = (request) => {
    if (request.kind === 'target') {
        request.onShown();
    }

    return RELEASE_NOTHING;
};

/** The host's revealer. The default does nothing. */
export const FieldRevealContext = createContext<FieldRevealer>(revealNothing);
