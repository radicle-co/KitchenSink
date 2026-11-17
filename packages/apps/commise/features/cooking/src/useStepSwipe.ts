'use client';

/**
 * @module useStepSwipe — the step swipe on a touch screen: an extra route between steps, judged by the shared
 * {@link stepSwipeOf} rule when the touch ends. Only a touch pointer counts, so a mouse drag selects text as before. The
 * start is a viewport coordinate and the width the viewport's, because the edge zones are the browser's own back
 * gestures. A cancelled gesture is no move.
 *
 * @pattern Headless hook — an Adapter from pointer events to a step move, over the `stepSwipeOf` Specification
 */
import { useState, type PointerEvent } from 'react';

import { stepSwipeOf } from './stepSwipe.js';

/** What {@link useStepSwipe} needs: where the cook can go, and what each move does. */
export interface StepSwipeOptions {
    readonly hasPrevious: boolean;
    readonly hasNext: boolean;
    readonly onNext: () => void;
    readonly onBack: () => void;
}

/** The pointer handlers the swipe surface takes. */
export interface StepSwipeHandlers {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: () => void;
}

/**
 * The pointer handlers for the swipe surface.
 *
 * @param options - Where the cook can go, and what each move does.
 * @returns The handlers to spread on the surface.
 * @sideEffect Calls `onNext` or `onBack` when a swipe ends as a move.
 */
export function useStepSwipe({ hasPrevious, hasNext, onNext, onBack }: StepSwipeOptions): StepSwipeHandlers {
    const [start, setStart] = useState<{ readonly x: number; readonly y: number } | null>(null);

    return {
        onPointerDown: (event) => {
            setStart(event.pointerType === 'touch' && event.isPrimary ? { x: event.clientX, y: event.clientY } : null);
        },
        onPointerUp: (event) => {
            if (start === null || event.pointerType !== 'touch') {
                return;
            }

            setStart(null);
            const move = stepSwipeOf({
                startX: start.x,
                dx: event.clientX - start.x,
                dy: event.clientY - start.y,
                width: window.innerWidth,
                hasPrevious,
                hasNext,
            });

            if (move === 'next') {
                onNext();
            } else if (move === 'back') {
                onBack();
            }
        },
        onPointerCancel: () => setStart(null),
    };
}
