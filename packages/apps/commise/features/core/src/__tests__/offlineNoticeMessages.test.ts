/**
 * The unreadable-work notice's copy (`specSharedSystem.md` §17), in the ONE dictionary both apps use.
 *
 * ⛔ The two rules the copy exists to keep: NO COUNT (a draft quarantine is raw bytes, so how many drafts it held is
 * unknowable, and the outbox's record count is a guess when the bytes do not parse), and it SAYS PLAINLY THAT THE WORK
 * CANNOT BE RECOVERED, because nothing in the UI can recover it.
 */
import { describe, expect, it } from 'vitest';

import { offlineNoticeMessages } from '../offline/messages.js';

const copy = offlineNoticeMessages.en;

describe('offlineNoticeMessages — unreadable work', () => {
    it('names the three strings the notice needs', () => {
        expect(copy.unreadableTitle).toBe('Some work on this device couldn’t be opened');
        expect(copy.unreadableDismiss).toBe('Dismiss');
        expect(copy.unreadableBody.length).toBeGreaterThan(0);
    });

    it('⛔ carries no count, digit or placeholder', () => {
        expect(copy.unreadableTitle).not.toMatch(/\d|\{/);
        expect(copy.unreadableBody).not.toMatch(/\d|\{/);
    });

    it('⛔ says plainly the work cannot be recovered, and where the safe copy is', () => {
        expect(copy.unreadableBody).toContain('can’t be recovered');
        expect(copy.unreadableBody).toContain('saved to your account are safe');
        expect(copy.unreadableBody).toContain('My recipes');
    });
});
