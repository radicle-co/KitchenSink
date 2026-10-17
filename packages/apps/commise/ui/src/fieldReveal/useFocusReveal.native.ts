/**
 * @module @commise/ui/field-reveal — a text field holds its place in the visible area while the cook types in it
 * (`docs/design/uiOverhaul/specSharedSystem.md` §16.3). The field sends the scroller's host a `focus` request when it
 * gains focus and releases it when it blurs or unmounts; the host keeps the field inside the visible area as the
 * keyboard rises and the pinned footer settles. The field holds no geometry.
 *
 * @pattern Command — the `focus` request, issued from an effect and undone by its release
 */
import { useContext, useEffect, useEffectEvent, type RefObject } from 'react';

import { FieldRevealContext, type RevealTarget } from './fieldRevealContext.js';

/** Releases nothing: what a field with no node to measure hands back. */
const RELEASE_NOTHING = (): void => undefined;

/**
 * Ask the field reveal host to hold this field in view for as long as it has focus.
 *
 * @param node - The field's node, read when the focus arrives.
 * @param focused - Whether the field has focus.
 * @sideEffect Sends a request to the host's revealer, and releases it.
 */
export function useFocusReveal(node: RefObject<RevealTarget | null>, focused: boolean): void {
    const reveal = useContext(FieldRevealContext);
    // Reads the node and the host's revealer as they are when the focus arrives; only the focus sends a request.
    const request = useEffectEvent((): (() => void) =>
        node.current === null ? RELEASE_NOTHING : reveal({ kind: 'focus', field: node.current }),
    );

    useEffect(() => (focused ? request() : undefined), [focused]);
}
