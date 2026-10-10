/** The paste hold (`pasteHold.ts`): one cell the paste writes and the editor reads. */
import { describe, expect, it } from 'vitest';

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
