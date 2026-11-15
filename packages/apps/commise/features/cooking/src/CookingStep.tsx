'use client';

/**
 * @module CookingStep — the web cooking step body.
 *
 * Top to bottom: the step track, the record of ticked lines behind a Show disclosure, the line count, the focus line, the
 * "Then" lines, and, once every line is ticked, Up next: the next step, its first line at the focus size. The one-line preview is not here: it is pinned in the foot. The body is a region named by the place, and the lines are checkboxes named by their text, in reading order. Which line is the
 * focus, and every string, are decided by the screen.
 *
 * Presentational: props → JSX.
 */
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import type { FC } from 'react';

import { CookingLineRow } from './CookingLineRow.js';
import type { CookingStepProps, CookingStepTrackProps } from './cookingViewProps.js';
import { FOCUS_LINE_TYPE } from './focusLineType.js';

/** The segment colour for a step: done, now, or later. */
const segmentClass = (step: number, position: number): string => {
    if (step < position) {
        return 'bg-ink-muted';
    }

    return step === position ? 'bg-here-bar' : 'bg-line-divider';
};

/** One 4 px segment per step. Hidden from assistive technology: the place says the same. */
const CookingStepTrack: FC<CookingStepTrackProps> = ({ total, position }) => (
    <div data-step-track aria-hidden="true" className="flex gap-1 px-2">
        {Array.from({ length: total }, (_, index) => (
            <span key={index} className={`h-1 flex-1 rounded-full ${segmentClass(index + 1, position)}`} />
        ))}
    </div>
);

/** The web cooking step body. */
export const CookingStep: FC<CookingStepProps> = ({ label, track, lineOf, ticked, focus, then, upNext }) => (
    <section aria-label={label} className="flex flex-col gap-4 px-2 py-4">
        <CookingStepTrack {...track} />
        {ticked === undefined ? null : (
            <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 px-2">
                    <p className="text-meta text-ink-muted">{ticked.summary}</p>
                    <button
                        type="button"
                        aria-expanded={ticked.expanded}
                        onClick={ticked.show.onPress}
                        className={`min-h-11 rounded-md px-2 text-body text-action-text ${FOCUS_RING_CLASS.inset}`}
                    >
                        {ticked.show.label}
                    </button>
                </div>
                {ticked.expanded && ticked.lines.length > 0 ? (
                    <ul className="flex flex-col">
                        {ticked.lines.map((line) => (
                            <li key={line.key}>
                                <CookingLineRow line={line} emphasis="other" />
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        )}
        {lineOf === undefined ? null : <p className="px-2 text-meta text-ink-muted">{lineOf}</p>}
        {focus === undefined ? null : <CookingLineRow line={focus} emphasis="focus" />}
        {then.length === 0 ? null : (
            <ul className="flex flex-col">
                {then.map((line) => (
                    <li key={line.key}>
                        <CookingLineRow line={line} emphasis="other" />
                    </li>
                ))}
            </ul>
        )}
        {upNext === undefined ? null : (
            <div className="flex flex-col gap-2 px-2 pt-2">
                <p className="text-label text-action-text">{upNext.overline}</p>
                <p className={`break-words text-ink ${FOCUS_LINE_TYPE.webClassName}`}>{upNext.lead}</p>
                {upNext.rest.map((text, index) => (
                    <p key={index} className="break-words text-reading-body text-ink">
                        {text}
                    </p>
                ))}
            </div>
        )}
    </section>
);
