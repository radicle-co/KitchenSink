import { describe, expect, it } from 'vitest';

import { commonMessages } from '../messages.js';

/**
 * The copy every feature shares. `undoGone` is what an Undo says when what it would undo no longer exists: it is a
 * plain sentence with the typographic apostrophe, as every sibling in both apps' dictionaries is written, and it names
 * no recipe or collection, so it reads the same wherever it is raised.
 */
describe('commonMessages', () => {
    it('says plainly that an Undo can no longer be done because the thing was deleted', () => {
        expect(commonMessages.en.undoGone).toBe('Can’t undo. It was deleted.');
    });

    it('uses the typographic apostrophe, never a straight one', () => {
        expect(commonMessages.en.undoGone).not.toContain("'");
    });

    it('says an Undo failed, and that the change is still in place, with the typographic apostrophe', () => {
        expect(commonMessages.en.undoFailed).toBe('Can’t undo. The change is still in place.');
    });
});
