'use client';

/**
 * @module @commise/ui/create-fab — the web design-system {@link CreateFab} (see `props.ts`). It reads its presentation
 * from `createFabPolicy` through `useFabPresentation`, so it shrinks to a disc while a phone scrolls down, grows back on
 * scroll up, at the top or on focus, hides with the keyboard and while it yields, and stays a disc when its label
 * would take more than half the window. While a snackbar shows it rises above it by the snackbar's height plus 8
 * (`fabLiftOver`), read from the host's `SnackbarClearanceContext`. Place it right after the page's H1 (`LargeTitleHeader.afterTitle`).
 *
 * Presentational about data — it fetches and mutates nothing — though its presentation reads the screen's scroll,
 * keyboard and window.
 *
 * @pattern Policy — `createFabPolicy` decides, the leaf draws
 * @pattern Adapter over `HTMLElement.focus()` — a level-triggered focus request, acknowledged once taken. It is the one
 *     reason this leaf holds a ref: focusing a control has no declarative form.
 */
import { useContext, useRef, useState, type FC } from 'react';

import { useFocusRequest } from '../focusRequest/useFocusRequest.js';

import { SnackbarClearanceContext } from '../snackbar/snackbarClearanceContext.js';
import type { CreateFabProps } from './props.js';
import { FabFace } from './FabFace.js';
import { fabLiftOver } from './fabLift.js';
import { fabBottomOf, fabSurfaceClass } from './fabSurfaceClass.js';
import { useFabPresentation } from './useFabPresentation.js';

/** The web design-system floating create button. */
export const CreateFab: FC<CreateFabProps> = ({
    label,
    icon,
    onPress,
    yielded = false,
    focusRequested = false,
    onFocusRequestHandled,
}) => {
    const node = useRef<HTMLButtonElement>(null);
    useFocusRequest(focusRequested, () => node.current?.focus(), onFocusRequestHandled);
    const [focused, setFocused] = useState(false);
    const [labelWidthPx, setLabelWidthPx] = useState(0);
    const presentation = useFabPresentation({ yielded, focused, labelWidthPx });
    // The snackbar is full width below `nav` and covers the button's corner, so the button rises above it while one shows.
    const lift = fabLiftOver(useContext(SnackbarClearanceContext));

    if (presentation === 'hidden') {
        return null;
    }

    return (
        <button
            ref={node}
            type="button"
            onClick={onPress}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            data-presentation={presentation}
            className={fabSurfaceClass(presentation)}
            style={{ bottom: fabBottomOf(lift) }}
        >
            <FabFace label={label} icon={icon} presentation={presentation} onLabelWidth={setLabelWidthPx} />
        </button>
    );
};
