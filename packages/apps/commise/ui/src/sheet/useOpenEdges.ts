/**
 * @module @commise/ui/sheet — how many times a sheet has opened and closed: the signals its leaves key a fresh panel on
 * and report `onDismissed` on (`docs/design/rowEditorBlueprint.md` decision 5).
 *
 * Adjusted during render, React's previous-value form, never in a ref: a discarded render's update dies with it, where
 * a ref's write would survive it (`useReturnFocusOnClose` records the same reason).
 */
import { useState } from 'react';

/** The counts of a sheet's opening and closing edges. */
export interface OpenEdges {
    /** The `false` to `true` edges so far. */
    readonly opens: number;
    /** The `true` to `false` edges so far. A sheet that mounts closed has none. */
    readonly closes: number;
}

/**
 * Count a sheet's opening and closing edges.
 *
 * @param open - Whether the sheet is open.
 * @returns The counts, which advance during the render that sees the edge.
 */
export function useOpenEdges(open: boolean): OpenEdges {
    const [wasOpen, setWasOpen] = useState(open);
    const [edges, setEdges] = useState<OpenEdges>({ opens: 0, closes: 0 });

    if (open !== wasOpen) {
        setWasOpen(open);
        setEdges(
            open ? { opens: edges.opens + 1, closes: edges.closes } : { opens: edges.opens, closes: edges.closes + 1 },
        );
    }

    return edges;
}
