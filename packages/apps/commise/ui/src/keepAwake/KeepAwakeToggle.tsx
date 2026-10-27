'use client';

/**
 * @module @commise/ui/keep-awake — the web design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with `aria-checked`, drawn as the secondary Button pill (`buttonToggleSurfaceClass`, 44 px, an outline,
 * the 16/20/600 `cardTitle`), NOT a chip: it sets a mode, it does not filter a list (`componentFixes` issue 6). While
 * on it takes the `selectedFill` with a `selectedEdge` outline of the same width, and the `sun` glyph is filled, so the
 * state never rests on colour alone. Icon-only it keeps "Screen on" as its name.
 *
 * It presses as `Button` does: the same `PressScale` wrapper, and while off the secondary pill's own hover and pressed
 * fill (`surface-muted`).
 *
 * Presentational apart from one capability read: with no Wake Lock API (an older browser, an insecure context) it
 * renders nothing at all. It is never shown disabled, because a control the cook can never use is noise.
 *
 * @pattern Null Object — renders nothing where the page cannot keep the screen awake
 */
import type { FC } from 'react';

import { buttonToggleSurfaceClass } from '../button/surfaceClass.js';
import { Icon } from '../icon/Icon.js';
import { PressScale } from '../pressScale/PressScale.js';
import type { KeepAwakeToggleProps } from './props.js';
import { useKeepAwakeAvailable } from './useKeepAwakeAvailable.js';

/** The web "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, display }) => {
    const available = useKeepAwakeAvailable();

    if (!available) {
        return null;
    }

    return (
        <PressScale>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={display === 'icon' ? label : undefined}
                onClick={() => onChange(!on)}
                className={
                    display === 'icon' ? `${buttonToggleSurfaceClass(on)} min-w-11` : buttonToggleSurfaceClass(on)
                }
            >
                <Icon name="sun" size={20} filled={on} />
                {display === 'labelled' ? <span>{label}</span> : null}
            </button>
        </PressScale>
    );
};
