/**
 * @module @commise/ui/field-reveal — how a native field hears that the cook began dragging the scroller around it. The
 * sibling of the field reveal: the field cannot see its scroller, so the scroller's host publishes a SUBSCRIBE function
 * through a context, and a field listens while it needs to (`Combobox` closes its open list on a drag that began outside
 * it: `docs/design/rowEditorOpenDecisions.md` item 7 puts that list in the page's flow, with no scroller of its own).
 *
 * @pattern Observer — the host's drag-begin, published to the fields that subscribe
 * @pattern Null Object — the default subscription hears nothing and releases nothing
 */
import { createContext } from 'react';

/** Listen for the start of the cook's drag on the scroller; returns the unsubscribe. */
export type ScrollerDragSubscribe = (listener: () => void) => () => void;

/** Releases nothing. */
const RELEASE_NOTHING = (): void => undefined;

/** The host's subscription. The default hears nothing: a field outside such a scroller is never told of a drag. */
export const ScrollerDragContext = createContext<ScrollerDragSubscribe>(() => RELEASE_NOTHING);
