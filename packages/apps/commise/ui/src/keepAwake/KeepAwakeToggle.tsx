'use client';

/**
 * @module @commise/ui/keep-awake — the web design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with `aria-checked`, drawn on the chip recipe (a pressable control, so a pill): the selected tint while
 * on, and the `sun` glyph filled, so the state never rests on colour alone. Icon-only it keeps "Screen on" as its name.
 *
 * Presentational apart from one capability read: with no Wake Lock API (an older browser, an insecure context) it
 * renders nothing at all. It is never shown disabled, because a control the cook can never use is noise.
 *
 * @pattern Null Object — renders nothing where the page cannot keep the screen awake
 */
import type { FC } from 'react';

import { chipClass } from '../chip/chipClass.js';
import { Icon } from '../icon/Icon.js';
import type { KeepAwakeToggleProps } from './props.js';
import { useKeepAwakeAvailable } from './useKeepAwakeAvailable.js';

/** The web "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, display }) => {
    const available = useKeepAwakeAvailable();

    if (!available) {
        return null;
    }

    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={display === 'icon' ? label : undefined}
            onClick={() => onChange(!on)}
            className={`${chipClass(on)} justify-center ${display === 'icon' ? 'min-w-11' : ''}`}
        >
            <Icon name="sun" size={16} filled={on} />
            {display === 'labelled' ? <span>{label}</span> : null}
        </button>
    );
};
