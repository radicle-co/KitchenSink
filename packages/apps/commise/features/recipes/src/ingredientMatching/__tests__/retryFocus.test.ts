/**
 * Unit tests for `retryFocus.ts`, the ONE rule for where focus goes when the cook presses Try again on a failed pick
 * (WCAG 2.2 SC 2.4.3 Focus Order; on native the screen-reader cursor). Every surface that shows a failed pick draws the
 * same rule, so these cases are the contract.
 *
 * The problem the rule answers: a retry in flight hides the failure (`failureOf`), so the Try again that held focus
 * unmounts and focus falls to the page. A single render cannot tell the three moments apart, so the rule reads the line's
 * send state BEFORE and AFTER:
 *
 * - a retry starts (failed, then failed and sending): focus lands on the control the retry made busy;
 * - a retry fails again (failed and sending, then failed): focus returns to the new Try again;
 * - a retry succeeds (failed, then not failed): no request, the host's `pickFocusOf` owns where focus goes next;
 * - a FIRST attempt, and a FIRST failure, ask for nothing: focus is already on the control the cook pressed, and a
 *   failure that lands later must not pull the cook away from wherever they have gone.
 */
import { describe, expect, it } from 'vitest';

import {
    lowerRetryRequest,
    noteAttention,
    ownsFocus,
    retryFocusOf,
    startRetryMemory,
    stepRetryMemory,
    type RetryMemory,
    type SendState,
} from '../retryFocus.js';

const send = (overrides: Partial<SendState> = {}): SendState => ({
    key: 'milk',
    failed: false,
    sending: false,
    ...overrides,
});

const IDLE = send();
const FIRST_ATTEMPT = send({ sending: true });
const FAILED = send({ failed: true });
const RETRYING = send({ failed: true, sending: true });

describe('retryFocusOf', () => {
    it('a retry starting asks for the control the retry made busy', () => {
        expect(retryFocusOf(FAILED, RETRYING)).toBe('landing');
    });

    it('a retry failing again asks for the new Try again', () => {
        expect(retryFocusOf(RETRYING, FAILED)).toBe('tryAgain');
    });

    it('a retry succeeding asks for nothing: the host moves focus as it does after a first pick', () => {
        expect(retryFocusOf(RETRYING, IDLE)).toBeUndefined();
    });

    it('a first attempt asks for nothing: focus is already on the control that was pressed', () => {
        expect(retryFocusOf(IDLE, FIRST_ATTEMPT)).toBeUndefined();
    });

    it('a first attempt failing asks for nothing: it must not pull the cook back from where they went', () => {
        expect(retryFocusOf(FIRST_ATTEMPT, FAILED)).toBeUndefined();
    });

    it('a line seen for the first time asks for nothing, whatever state it arrives in', () => {
        expect(retryFocusOf(undefined, RETRYING)).toBeUndefined();
        expect(retryFocusOf(undefined, FAILED)).toBeUndefined();
    });

    it('an unchanged state asks for nothing', () => {
        expect(retryFocusOf(RETRYING, RETRYING)).toBeUndefined();
        expect(retryFocusOf(FAILED, FAILED)).toBeUndefined();
    });
});

describe('stepRetryMemory', () => {
    const memoryOf = (...sends: readonly SendState[]): RetryMemory => startRetryMemory(sends);

    it('raises the landing request on the render a retry starts, for that line only', () => {
        const next = stepRetryMemory(memoryOf(FAILED, send({ key: 'bread', failed: true })), [
            RETRYING,
            send({ key: 'bread', failed: true }),
        ]);

        expect(next.requests.get('milk')).toBe('landing');
        expect(next.requests.has('bread')).toBe(false);
    });

    it('raises the Try again request on the render a retry fails again, and the landing request is gone', () => {
        const landed = lowerRetryRequest(stepRetryMemory(memoryOf(FAILED), [RETRYING]), 'milk', 'landing');
        const next = stepRetryMemory(landed, [FAILED]);

        expect(next.requests.get('milk')).toBe('tryAgain');
    });

    it('drops a standing request when the retry succeeds, so a control that appears later is not taken from the cook', () => {
        const retrying = stepRetryMemory(memoryOf(FAILED), [RETRYING]);
        const next = stepRetryMemory(retrying, [IDLE]);

        expect(next.requests.has('milk')).toBe(false);
    });

    it('keeps a standing request through an unrelated render', () => {
        const retrying = stepRetryMemory(memoryOf(FAILED), [RETRYING]);

        expect(stepRetryMemory(retrying, [RETRYING]).requests.get('milk')).toBe('landing');
    });

    it('returns the SAME memory when nothing changed, so a render-time update cannot loop', () => {
        const memory = memoryOf(RETRYING);

        expect(stepRetryMemory(memory, [RETRYING])).toBe(memory);
    });

    it('forgets a line that is no longer drawn, so it starts fresh if it returns', () => {
        const retrying = stepRetryMemory(memoryOf(FAILED), [RETRYING]);
        const gone = stepRetryMemory(retrying, []);

        expect(gone.requests.size).toBe(0);
        expect(gone.seen.size).toBe(0);
        // Back, failed and retrying: a first sight, so no request.
        expect(stepRetryMemory(gone, [RETRYING]).requests.size).toBe(0);
    });
});

describe('lowerRetryRequest', () => {
    it('lowers the named request once the control has taken focus', () => {
        const raised = stepRetryMemory(startRetryMemory([FAILED]), [RETRYING]);

        expect(lowerRetryRequest(raised, 'milk', 'landing').requests.has('milk')).toBe(false);
    });

    it('does not lower a different request: the landing control reporting cannot cancel the Try again to come', () => {
        const raised = stepRetryMemory(startRetryMemory([FAILED]), [RETRYING]);
        const later = stepRetryMemory(raised, [FAILED]);

        expect(lowerRetryRequest(later, 'milk', 'landing').requests.get('milk')).toBe('tryAgain');
    });

    it('returns the same memory when there is nothing to lower', () => {
        const memory = startRetryMemory([IDLE]);

        expect(lowerRetryRequest(memory, 'milk', 'landing')).toBe(memory);
    });
});

/**
 * ATTENTION (blueprint "Host gap rules" 1): Try again must not steal focus. A retry's focus is a promise to the cook who
 * pressed it; once the cook has acted on ANOTHER line the promise is void, and so is the host's `pickFocusOf` move for
 * the line that was left behind. Seen red first: with no attention in the memory, a retry that landed after the cook had
 * moved on pulled focus back to the old line.
 */
describe('attention', () => {
    const BREAD_FAILED = send({ key: 'bread', failed: true });
    const BREAD_RETRYING = send({ key: 'bread', failed: true, sending: true });

    it('starts with no attention: every line owns focus', () => {
        const memory = startRetryMemory([FAILED, BREAD_FAILED]);

        expect(memory.attention).toBeUndefined();
        expect(ownsFocus(memory, 'milk')).toBe(true);
        expect(ownsFocus(memory, 'bread')).toBe(true);
    });

    it('noteAttention hands focus ownership to that line alone', () => {
        const memory = noteAttention(startRetryMemory([FAILED, BREAD_FAILED]), 'bread');

        expect(memory.attention).toBe('bread');
        expect(ownsFocus(memory, 'bread')).toBe(true);
        expect(ownsFocus(memory, 'milk')).toBe(false);
    });

    it("noteAttention drops every standing request that belongs to another line, and keeps the line's own", () => {
        const raised = stepRetryMemory(startRetryMemory([FAILED, BREAD_FAILED]), [RETRYING, BREAD_RETRYING]);

        expect([...raised.requests.keys()].sort()).toEqual(['bread', 'milk']);

        const moved = noteAttention(raised, 'bread');

        expect([...moved.requests.keys()]).toEqual(['bread']);
        expect(moved.requests.get('bread')).toBe('landing');
    });

    it('a retry that fails again on a line the cook has left raises no Try again request', () => {
        const retrying = stepRetryMemory(startRetryMemory([FAILED, BREAD_FAILED]), [RETRYING, BREAD_FAILED]);
        const moved = noteAttention(retrying, 'bread');
        const failedAgain = stepRetryMemory(moved, [FAILED, BREAD_FAILED]);

        expect(failedAgain.requests.has('milk')).toBe(false);
        expect(failedAgain.attention).toBe('bread');
    });

    it('a retry that STARTS on a line the cook has left raises no landing request', () => {
        const moved = noteAttention(startRetryMemory([FAILED, BREAD_FAILED]), 'bread');
        const next = stepRetryMemory(moved, [RETRYING, BREAD_FAILED]);

        expect(next.requests.has('milk')).toBe(false);
    });

    it('requests still rise for the line the cook IS on', () => {
        const moved = noteAttention(startRetryMemory([FAILED, BREAD_FAILED]), 'milk');

        expect(stepRetryMemory(moved, [RETRYING, BREAD_FAILED]).requests.get('milk')).toBe('landing');
    });

    it('returns the SAME memory when attention already rests on the line and no other request stands', () => {
        const memory = noteAttention(startRetryMemory([FAILED]), 'milk');

        expect(noteAttention(memory, 'milk')).toBe(memory);
    });

    it('lowering a request and stepping keep the attention', () => {
        const memory = noteAttention(startRetryMemory([FAILED]), 'milk');
        const raised = stepRetryMemory(memory, [RETRYING]);

        expect(lowerRetryRequest(raised, 'milk', 'landing').attention).toBe('milk');
        expect(stepRetryMemory(raised, [IDLE]).attention).toBe('milk');
    });
});
