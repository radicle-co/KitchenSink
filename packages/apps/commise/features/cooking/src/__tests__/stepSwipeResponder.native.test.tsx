/**
 * The responder the step body hands the frame: it claims a drag only once it is a whole sideways swipe, so a vertical
 * scroll and a tap that wobbles stay with the scroller and the rows, and at release it moves only for a swipe that is
 * still whole then (a finger that went far and came back moves nothing).
 */
import { describe, expect, it, vi } from 'vitest';

import { stepSwipeResponderOf } from '../stepSwipeResponder.native.js';

/** A responder event whose last touch started at (startX, 300) and is now at (nowX, nowY). */
const touch = (startX: number, nowX: number, nowY = 300): object => ({
    touchHistory: {
        touchBank: [
            { startPageX: startX, startPageY: 300, currentPageX: nowX, currentPageY: nowY, currentTimeStamp: 2 },
        ],
    },
});

function responder(over: { hasPrevious?: boolean; hasNext?: boolean } = {}) {
    const onNext = vi.fn();
    const onBack = vi.fn();
    const handlers = stepSwipeResponderOf({ width: 390, hasPrevious: true, hasNext: true, ...over, onNext, onBack });

    return { ...handlers, onNext, onBack };
}

describe('stepSwipeResponderOf', () => {
    it('claims a whole sideways swipe', () => {
        expect(responder().onMoveShouldSetResponder(touch(330, 60, 310))).toBe(true);
    });

    it.each([
        ['a vertical drag (a scroll)', touch(200, 210, 600)],
        ['a sideways wobble under the threshold (a tap)', touch(200, 160)],
        ['a swipe from the left screen edge', touch(4, 330)],
    ])('leaves %s to the scroller and the rows', (_name, event) => {
        expect(responder().onMoveShouldSetResponder(event)).toBe(false);
    });

    it('goes next on a left swipe and back on a right swipe at release', () => {
        const left = responder();
        left.onResponderRelease(touch(330, 60, 310));
        expect([left.onNext.mock.calls.length, left.onBack.mock.calls.length]).toEqual([1, 0]);

        const right = responder();
        right.onResponderRelease(touch(60, 330, 310));
        expect([right.onNext.mock.calls.length, right.onBack.mock.calls.length]).toEqual([0, 1]);
    });

    // The finger went past the threshold and came back before it lifted: at release the swipe rule decides again.
    it('moves nothing when the finger is back under the threshold at release', () => {
        const back = responder();

        back.onResponderRelease(touch(330, 300));

        expect([back.onNext.mock.calls.length, back.onBack.mock.calls.length]).toEqual([0, 0]);
    });

    it('moves nothing when the release carries no readable touch', () => {
        const none = responder();

        none.onResponderRelease({});

        expect([none.onNext.mock.calls.length, none.onBack.mock.calls.length]).toEqual([0, 0]);
    });
});
