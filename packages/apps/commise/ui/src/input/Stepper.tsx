'use client';

/**
 * @module @commise/ui/input — the web design-system {@link Stepper}: `[−] value [+]` for a small whole number (spec
 * §1.11).
 *
 * A named `group` holding two 44 px round buttons and the value in `figure` digits. A press reports the stepped value
 * and speaks the caller's `announce` sentence politely (a visually hidden `LiveRegion`). At a bound the button refuses
 * the press through `refusedPressProps` — `aria-disabled`, the click cancelled — rather than native `disabled`: the
 * button at its bound is the one just pressed, and a browser drops focus from a disabled control (SC 2.4.3).
 *
 * `'use client'`: the announcement is state.
 *
 * @pattern Controlled input — the value is the caller's; the step rule (`stepFrom`) is pure
 */
import { useState, type FC } from 'react';

import type { IconName } from '../icon/props.js';
import { IconButton } from '../iconButton/IconButton.js';
import { LiveRegion } from '../liveRegion/LiveRegion.js';
import { stepFrom, type StepperProps } from './props.js';

/**
 * The frame of a step button: a 44 CSS px circle on the neutral surface with its 1 px control line. The icon button
 * sits inside and overlays that line by a pixel, so the button's own 44 target is the whole frame.
 */
const STEP_FRAME =
    'inline-flex size-[44px] shrink-0 items-center justify-center rounded-full border border-line-control bg-paper';

/** The web design-system stepper. */
export const Stepper: FC<StepperProps> = ({
    id,
    label,
    labelVisibility = 'visible',
    value,
    min = 1,
    max,
    onChange,
    announce,
    decreaseLabel,
    increaseLabel,
}) => {
    const [spoken, setSpoken] = useState({ text: '', occurrence: 0 });
    const labelId = `${id}-label`;

    const stepButton = (step: -1 | 1, name: string, glyph: IconName) => {
        const next = stepFrom(value, step, min, max);

        return (
            <span className={STEP_FRAME}>
                <span className="-m-px inline-flex">
                    <IconButton
                        icon={glyph}
                        accessibilityLabel={name}
                        disabled={next === null}
                        onPress={() => {
                            if (next === null) {
                                return;
                            }

                            onChange(next);
                            setSpoken((previous) => ({ text: announce(next), occurrence: previous.occurrence + 1 }));
                        }}
                    />
                </span>
            </span>
        );
    };

    return (
        <div className="flex flex-col gap-1">
            <span id={labelId} className={labelVisibility === 'hidden' ? 'sr-only' : 'text-label text-ink-muted'}>
                {label}
            </span>
            <div role="group" aria-labelledby={labelId} className="flex items-center gap-2">
                {stepButton(-1, decreaseLabel, 'minus')}
                <span className="min-w-6 text-center text-body font-semibold tabular-nums lining-nums text-ink">
                    {value}
                </span>
                {stepButton(1, increaseLabel, 'plus')}
            </div>
            <LiveRegion politeness="polite" visuallyHidden occurrence={spoken.occurrence}>
                {spoken.text}
            </LiveRegion>
        </div>
    );
};
