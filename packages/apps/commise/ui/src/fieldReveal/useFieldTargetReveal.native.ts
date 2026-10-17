/**
 * @module @commise/ui/field-reveal — a field answers the screen naming it (`docs/design/uiOverhaul/specSharedSystem.md`
 * §16.3). The native `ScrollHost` counts how many times `scrollToField(id)` was called for each id
 * (`FieldTargetContext`); the field reads the count of its own id and, when it goes UP, sends the reveal host a `target`
 * request. The host centres the field and calls `onShown`, and the field moves the screen-reader cursor to itself.
 *
 * ⛔ It never calls `.focus()`. A refused Publish takes the cook to the field, and the keyboard stays down: the cook
 * has not chosen to type. Moving the screen-reader cursor raises no `onFocus`, so a combobox's list stays shut too.
 *
 * A count is a level, so a field that mounts under a standing count (a screen that mounts after three refusals) is
 * inert, and only a later increase moves it. The count it mounted under is held in state, not a ref.
 *
 * @pattern Observer — the field watches the count of its own id
 * @pattern Adapter — the count becomes a `target` request, and `onShown` becomes the screen-reader cursor
 */
import { useContext, useEffect, useEffectEvent, useState, type RefObject } from 'react';

import {
    moveScreenReaderFocus,
    type ScreenReaderFocusTarget,
} from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { useFieldTarget } from '../scrollHost/fieldTarget.js';
import { FieldRevealContext, type RevealTarget } from './fieldRevealContext.js';

/**
 * Show this field, and move the screen-reader cursor to it, each time the screen names it.
 *
 * @param id - The field's id, the one the screen passes to `scrollToField`.
 * @param node - The field's node, read when the host has shown it.
 * @sideEffect Sends a request to the host's revealer, and moves the screen-reader cursor.
 */
export function useFieldTargetReveal(
    id: string,
    node: RefObject<(RevealTarget & ScreenReaderFocusTarget) | null>,
): void {
    const count = useFieldTarget(id);
    const reveal = useContext(FieldRevealContext);
    // The count this field mounted under: the level it is inert at.
    const [mountedAt] = useState(count);
    // Reads the node and the host's revealer as they are when the count rises; only a rise sends a request.
    const request = useEffectEvent((): (() => void) | undefined =>
        node.current === null
            ? undefined
            : reveal({
                  kind: 'target',
                  field: node.current,
                  onShown: () => {
                      moveScreenReaderFocus(node.current);
                  },
              }),
    );

    useEffect(() => (count > mountedAt ? request() : undefined), [count, mountedAt]);
}
