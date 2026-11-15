/**
 * @module @commise/ui/field-reveal — an element answers the screen naming its start (`ScrollHost.scrollToStart`). The
 * native `ScrollHost` counts how many times `scrollToStart(id)` was called for each id (`FieldTargetContext`, the same
 * cursor `scrollToField` uses, over ids no field shares); the element reads the count of its own id and, when it goes
 * UP, sends the reveal host a `start` request. The host puts its top at the top of the visible area. A call with
 * `{ nearest: true }` counts under its own key (`nearestStartKey`), and the request it sends carries `nearest`: the host
 * then shows the element only when it is hidden.
 *
 * Unlike `useFieldTargetReveal` it moves no screen-reader cursor and never takes focus: a row's own sheet or notice owns
 * those. A count is a level, so an element that mounts under a standing count is inert, and only a later increase moves
 * it. The count it mounted under is held in state, not a ref.
 *
 * @pattern Observer — the element watches the count of its own id
 * @pattern Adapter — the count becomes a `start` request
 */
import { useContext, useEffect, useEffectEvent, useState, type RefObject } from 'react';

import { nearestStartKey, useFieldTarget } from '../scrollHost/fieldTarget.js';
import { FieldRevealContext, type RevealTarget } from './fieldRevealContext.js';

/**
 * Put this element's top at the top of the visible area, each time the screen names it.
 *
 * @param id - The element's id, the one the screen passes to `scrollToStart`.
 * @param node - The element's node, read when the count rises.
 * @sideEffect Sends a request to the host's revealer.
 */
export function useFieldStartReveal(id: string, node: RefObject<RevealTarget | null>): void {
    const count = useFieldTarget(id);
    const nearestCount = useFieldTarget(nearestStartKey(id));
    const reveal = useContext(FieldRevealContext);
    // The counts this element mounted under: the levels it is inert at.
    const [mountedAt] = useState(count);
    const [nearestMountedAt] = useState(nearestCount);
    // Reads the node and the host's revealer as they are when a count rises; only a rise sends a request.
    const request = useEffectEvent((nearest: boolean): (() => void) | undefined =>
        node.current === null
            ? undefined
            : reveal(
                  nearest
                      ? { kind: 'start', field: node.current, nearest: true }
                      : { kind: 'start', field: node.current },
              ),
    );

    useEffect(() => (count > mountedAt ? request(false) : undefined), [count, mountedAt]);
    useEffect(() => (nearestCount > nearestMountedAt ? request(true) : undefined), [nearestCount, nearestMountedAt]);
}
