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
 * One opening's request.
 *
 * @notWireShape a field's in-process request to the scroller around it; never serialised or sent anywhere
 */
export interface RevealRequest {
    readonly field: RevealTarget;
    /** The dp the field needs below it, from its own layout constants (the list's margin, padding and rows). */
    readonly below: number;
    /**
     * What the field asks to be shown. A `list` is the field and the list that opened below it, shown by laying out
     * blank space and scrolling the field to the top. An `arrival` is a row that just arrived straight above the field,
     * shown with the field by the smallest scroll, and never with blank space
     * (`docs/design/uiOverhaul/ingredientArrival.md`).
     */
    readonly kind: 'list' | 'arrival';
    /** The dp from the top of the row that arrived to the top of the field; `0` for a `list`. */
    readonly above: number;
}

/** Ask the host to show the field and the room below it. Called from an effect, never in render; returns the release. */
export type FieldRevealer = (request: RevealRequest) => () => void;

/** Releases nothing. */
const RELEASE_NOTHING = (): void => undefined;

/** The revealer of a field no scroller can show: it asks nothing and releases nothing. */
export const revealNothing: FieldRevealer = () => RELEASE_NOTHING;

/** The host's revealer. The default does nothing. */
export const FieldRevealContext = createContext<FieldRevealer>(revealNothing);
