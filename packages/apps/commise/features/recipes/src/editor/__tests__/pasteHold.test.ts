/** The paste hold (`pasteHold.ts`): one cell the paste writes and the editor reads. */
import { describe, expect, it, vi } from 'vitest';

import { createPasteHold } from '../pasteHold.js';

describe('createPasteHold', () => {
    it('starts not holding, and answers what was last set', () => {
        const hold = createPasteHold();

        expect(hold.get()).toBe(false);
        hold.set(true);
        expect(hold.get()).toBe(true);
        hold.set(false);
        expect(hold.get()).toBe(false);
    });

    it('two holds are independent', () => {
        const a = createPasteHold();
        const b = createPasteHold();

        a.set(true);
        expect(b.get()).toBe(false);
    });
});

/**
 * A-021: a paste whose lines join as NO rows (headings, measure-only lines) leaves the draft unchanged, so nothing
 * re-arms the idle timer, and the create the hold deferred waited for the next blur, section change or exit. The hold
 * now says when it lets go, so the editor can run the checkpoint it deferred.
 */
describe('createPasteHold — the release', () => {
    it('tells a listener once when the hold goes from holding to not holding', () => {
        const hold = createPasteHold();
        const released = vi.fn();
        hold.onReleased(released);

        hold.set(true);
        expect(released).not.toHaveBeenCalled();
        hold.set(false);
        hold.set(false);

        expect(released).toHaveBeenCalledTimes(1);
    });

    it('does not tell anyone about a hold that was never taken', () => {
        const hold = createPasteHold();
        const released = vi.fn();
        hold.onReleased(released);

        hold.set(false);

        expect(released).not.toHaveBeenCalled();
    });

    it('⛔ stays quiet when the paste goes away: nobody is left to checkpoint for', () => {
        const hold = createPasteHold();
        const released = vi.fn();
        hold.onReleased(released);

        hold.set(true);
        hold.discard();

        expect(hold.get()).toBe(false);
        expect(released).not.toHaveBeenCalled();
    });

    it('stops telling a listener that unsubscribed', () => {
        const hold = createPasteHold();
        const released = vi.fn();
        hold.onReleased(released)();

        hold.set(true);
        hold.set(false);

        expect(released).not.toHaveBeenCalled();
    });
});
