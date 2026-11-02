'use client';

/**
 * @module @commise/ui/keep-awake — the web design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with `aria-checked`, drawn as the QUIET Button surface (`buttonSurfaceClass('quiet')`): the `sun` glyph and the
 * label, no fill and no outline, sitting in the action row after Edit recipe or Save a copy (designer, iosBatch1). It sets
 * a mode, it does not filter a list (`componentFixes` issue 6), and the glyph is filled while on, so the state never rests
 * on colour alone.
 *
 * It presses as `Button` does: the same `PressScale` wrapper.
 *
 * Presentational apart from one capability read: with no Wake Lock API (an older browser, an insecure context) it
 * renders nothing at all. It is never shown disabled, because a control the cook can never use is noise.
 *
 * @pattern Null Object — renders nothing where the page cannot keep the screen awake
 */
import type { FC } from 'react';

import { buttonSurfaceClass } from '../button/surfaceClass.js';
import { Icon } from '../icon/Icon.js';
import { PressScale } from '../pressScale/PressScale.js';
import type { KeepAwakeToggleProps } from './props.js';
import { useKeepAwakeAvailable } from './useKeepAwakeAvailable.js';

/** The web "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, hint }) => {
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
                aria-description={hint}
                onClick={() => onChange(!on)}
                className={buttonSurfaceClass('quiet', { size: 'md' })}
            >
                <Icon name="sun" size={20} filled={on} />
                <span>{label}</span>
            </button>
        </PressScale>
    );
};
