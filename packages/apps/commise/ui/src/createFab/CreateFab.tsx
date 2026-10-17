'use client';

/**
 * @module @commise/ui/create-fab — the web design-system {@link CreateFab} (see `props.ts`). It reads its presentation
 * from `createFabPolicy` through `useFabPresentation`, so it shrinks to a disc while a phone scrolls down, grows back on
 * scroll up, at the top or on focus, hides with the keyboard and in first run, and stays a disc when its label would
 * take more than half the window. Place it right after the page's H1 (`LargeTitleHeader.afterTitle`).
 *
 * Presentational about data — it fetches and mutates nothing — though its presentation reads the screen's scroll,
 * keyboard and window.
 *
 * @pattern Policy — `createFabPolicy` decides, the leaf draws
 */
import { useState, type FC } from 'react';

import type { CreateFabProps } from './props.js';
import { FabFace } from './FabFace.js';
import { fabSurfaceClass } from './fabSurfaceClass.js';
import { useFabPresentation } from './useFabPresentation.js';

/** The web design-system floating create button. */
export const CreateFab: FC<CreateFabProps> = ({ label, icon, onPress, firstRun = false }) => {
    const [focused, setFocused] = useState(false);
    const [labelWidthPx, setLabelWidthPx] = useState(0);
    const presentation = useFabPresentation({ firstRun, focused, labelWidthPx });

    if (presentation === 'hidden') {
        return null;
    }

    return (
        <button
            type="button"
            onClick={onPress}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            data-presentation={presentation}
            className={fabSurfaceClass(presentation)}
        >
            <FabFace label={label} icon={icon} presentation={presentation} onLabelWidth={setLabelWidthPx} />
        </button>
    );
};
