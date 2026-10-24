'use client';

/**
 * @module @commise/ui/live-region — the web `LiveRegion`: text whose appearance and changes are spoken. An `assertive`
 * region is an `alert`, a `polite` one a `status`; each is mounted before it has anything to say (empty), because a
 * live region speaks at a change of its text.
 *
 * With an `occurrence`, two regions are mounted and the message moves to the other one at each change of it
 * (`useOccurrenceSlot`, `docs/design/rowEditorOpenDecisions.md` R8), so the same text said again is a change from empty
 * on a region that already exists. The technique is GOV.UK `accessible-autocomplete`'s (`src/status.js`).
 *
 * A region with nothing to say is visually hidden, so a mounted, empty region takes no space in its host's layout.
 *
 * @pattern Adapter over the ARIA live-region channel
 */
import type { FC } from 'react';

import type { LiveRegionPoliteness, LiveRegionProps } from './props.js';
import { useOccurrenceSlot } from './useOccurrenceSlot.js';

const ROLE: Readonly<Record<LiveRegionPoliteness, 'alert' | 'status'>> = { assertive: 'alert', polite: 'status' };

/** One mounted region. */
const Region: FC<{ readonly text: string; readonly politeness: LiveRegionPoliteness; readonly className?: string }> = ({
    text,
    politeness,
    className,
}) => (
    <span role={ROLE[politeness]} className={text === '' ? 'sr-only' : className}>
        {text}
    </span>
);

/** Text whose appearance and changes are announced to the screen reader. */
export const LiveRegion: FC<LiveRegionProps> = ({
    children,
    politeness,
    occurrence,
    visuallyHidden = false,
    className,
}) => {
    const slot = useOccurrenceSlot(occurrence);
    const classes = visuallyHidden ? 'sr-only' : className;

    if (occurrence === undefined) {
        return (
            <Region
                text={children}
                politeness={politeness}
                {...(classes === undefined ? {} : { className: classes })}
            />
        );
    }

    return (
        <>
            <Region
                text={slot === 0 ? children : ''}
                politeness={politeness}
                {...(classes === undefined ? {} : { className: classes })}
            />
            <Region
                text={slot === 1 ? children : ''}
                politeness={politeness}
                {...(classes === undefined ? {} : { className: classes })}
            />
        </>
    );
};
