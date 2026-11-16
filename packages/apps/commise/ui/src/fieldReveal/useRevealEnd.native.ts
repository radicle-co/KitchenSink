/**
 * @module @commise/ui/field-reveal — a row names itself as the end of the fields inside it. An open row editor holds its
 * Done and Cancel at the row's bottom, and the keyboard can cover them while the cook types in a field above; a `focus`
 * request that carries the row as its `end` lets the host keep both in view when they fit (`useFieldRevealHost.native.ts`).
 *
 * The row's node is read only when the host measures the end, never in render. A node that is gone cannot be measured,
 * and the host reads that as "no end" and shows the field alone.
 *
 * @pattern Decorator — wraps the parent revealer (`withRevealEnd`) for the fields inside the row
 * @pattern Adapter — the row's ref becomes the `RevealTarget` the host measures
 */
import { useContext, useMemo, type RefObject } from 'react';

import { FieldRevealContext, withRevealEnd, type FieldRevealer, type RevealTarget } from './fieldRevealContext.js';

/**
 * The revealer for the fields inside a row: the host's own, with the row as the `end` of every `focus` request.
 *
 * @param node - The row's node, read when the host measures.
 * @returns A revealer to provide to the row's fields; its identity changes only with the host's revealer.
 */
export function useRevealEnd(node: RefObject<RevealTarget | null>): FieldRevealer {
    const parent = useContext(FieldRevealContext);

    return useMemo(
        () =>
            withRevealEnd(parent, {
                measureLayout: (relativeTo, onSuccess, onFail) => {
                    if (node.current === null) {
                        onFail?.();
                    } else {
                        node.current.measureLayout(relativeTo, onSuccess, onFail);
                    }
                },
            }),
        [parent, node],
    );
}
