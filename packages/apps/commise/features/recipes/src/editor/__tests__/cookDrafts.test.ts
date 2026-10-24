/**
 * The signed-in cook's device-draft store, resolved from an app's one key/value store. Moved here from the web's
 * `editorDrafts.ts` and mobile's `storage/editorDrafts.ts`, which were the same two lines bound to different stores
 * (characterization: `web/.../deviceSession.test.ts` and `mobile/.../deviceSession.native.test.tsx` kept their cases
 * and now reach the store through this module).
 *
 * What is pinned: no cook means no store (never a placeholder subject, which would be one shared draft for every
 * signed-out visitor, ADR-0054); one store object per (device store, cook), so the editor, the outbox observer and the
 * session end share one serial queue (ADR-0057); and Clerk's three states for the cook — `undefined` while loading,
 * `null` signed out, an id — all read as "nobody" or "this cook" and never as a store for a placeholder.
 */
import { describe, expect, it } from 'vitest';

import { createMemoryOutboxStore } from '@kitchensink/sync';

import { cookDraftsOf, editorDraftsFor } from '../cookDrafts.js';
import { draftStoreFor } from '../draftStore.js';

describe('editorDraftsFor', () => {
    it('answers no store while nobody is signed in', () => {
        expect(editorDraftsFor(createMemoryOutboxStore(), undefined)).toBeUndefined();
    });

    it('answers the one memoized store for a cook on a device store', () => {
        const device = createMemoryOutboxStore();

        expect(editorDraftsFor(device, 'user_a')).toBe(draftStoreFor(device, 'user_a'));
        expect(editorDraftsFor(device, 'user_a')).toBe(editorDraftsFor(device, 'user_a'));
    });

    it('keeps a store per cook and per device store', () => {
        const device = createMemoryOutboxStore();

        expect(editorDraftsFor(device, 'user_a')).not.toBe(editorDraftsFor(device, 'user_b'));
        expect(editorDraftsFor(device, 'user_a')).not.toBe(editorDraftsFor(createMemoryOutboxStore(), 'user_a'));
    });
});

describe('cookDraftsOf', () => {
    it.each([
        ['loading', undefined],
        ['signed out', null],
    ])('answers nobody while Clerk reports the cook as %s', (_state, userId) => {
        expect(cookDraftsOf(createMemoryOutboxStore(), userId)).toBeUndefined();
    });

    it('pairs the signed-in cook with their draft store', () => {
        const device = createMemoryOutboxStore();

        expect(cookDraftsOf(device, 'user_a')).toEqual({ subject: 'user_a', drafts: draftStoreFor(device, 'user_a') });
    });
});
