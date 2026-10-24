/**
 * `collectionsBackOf`: the ONE place the collection detail's "Back to Collections" is built, for the native bar, the web
 * bar, the web header's eyebrow and the not-found notice's own action (it was five hand-built copies, three of them with
 * their own `.replace('{parent}', …)`). Pure.
 */
import { describe, expect, it, vi } from 'vitest';

import { collectionsBackOf } from '../detailModel.js';
import { collectionMessages } from '../messages.js';

const messages = collectionMessages.en;

describe('collectionsBackOf', () => {
    it('names the control for the list, and the list as its parent', () => {
        const onPress = vi.fn();
        const back = collectionsBackOf(messages, onPress);

        expect(back.label).toBe('Back to Collections');
        expect(back.parent).toBe('Collections');
        expect(back.onPress).toBe(onPress);
    });

    it('carries the list’s address for a real link, and only when it has one', () => {
        const withHref = collectionsBackOf(messages, vi.fn(), '/en/collections');
        const withoutHref = collectionsBackOf(messages, vi.fn());

        expect(withHref.href).toBe('/en/collections');
        // Absent, not `undefined`: `HeaderBack.href?` rejects an explicit `undefined`.
        expect('href' in withoutHref).toBe(false);
    });

    it('reads the parent from the list’s heading, so a retitled list retitles the Back', () => {
        const back = collectionsBackOf({ ...messages, list: { ...messages.list, heading: 'Cookbooks' } }, vi.fn());

        expect(back.label).toBe('Back to Cookbooks');
        expect(back.parent).toBe('Cookbooks');
    });
});
