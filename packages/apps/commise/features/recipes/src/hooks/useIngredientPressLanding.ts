/**
 * When the cook's ingredient add or removal LANDS in the filter (curated U9, spec §S8.1a "Focus at the cap").
 *
 * The control the cook pressed unmounts once the change lands, so focus has to move then, not at the press. On web the
 * container writes the filter to the URL, and the new filter arrives a render after the press; on mobile it arrives in
 * the same render. So the signal advances on the first render whose ingredient count differs from the count at the
 * press. A change nobody pressed (a URL fill, back navigation) never advances it, and neither does mounting.
 *
 * The press is recorded and consumed with React's "adjust state while rendering" pattern rather than an effect, so the
 * signal and the change commit in one render and the focus hook sees the node that then holds the search slot.
 *
 * @pattern State — a pending press, consumed when the count it was made against changes
 */
import { useState } from 'react';

/** What {@link useIngredientPressLanding} gives the filter bar. */
export interface IngredientPressLanding {
    /** Advances once each time a pressed change lands. Drives a focus hook; inert on mount. */
    readonly signal: number;
    /** Record that the cook pressed an add or a removal. */
    readonly markPressed: () => void;
}

/**
 * Track the cook's ingredient presses until each lands.
 *
 * @param count - How many ingredients the filter holds now.
 * @returns The landing signal and the press recorder.
 */
export function useIngredientPressLanding(count: number): IngredientPressLanding {
    const [pressedAt, setPressedAt] = useState<number | undefined>(undefined);
    const [signal, setSignal] = useState(0);

    if (pressedAt !== undefined && pressedAt !== count) {
        setPressedAt(undefined);
        setSignal(signal + 1);
    }

    return { signal, markPressed: () => setPressedAt(count) };
}
