/**
 * The Ingredients "Reading…" label (designer condition 1): ONE ellipsis character, U+2026, the same text the paste's
 * rows say, never three full stops. The two strings live in two message bundles, so this is where they are held equal.
 */
import { describe, expect, it } from 'vitest';

import { recipeFormMessages } from '../../form/messages.js';
import { editorMessages } from '../messages.js';

describe('the Ingredients reading label', () => {
    it('is "Reading" and a single U+2026, not three dots', () => {
        const label = editorMessages.en.index.reason.ingredientsReading;

        expect(label).toBe('Reading…');
        expect(label).not.toContain('...');
        expect([...label].filter((character) => character === '…')).toHaveLength(1);
    });

    it('is the text the paste rows say while a line is read', () => {
        expect(editorMessages.en.index.reason.ingredientsReading).toBe(recipeFormMessages.en.rowStateReading);
    });
});
