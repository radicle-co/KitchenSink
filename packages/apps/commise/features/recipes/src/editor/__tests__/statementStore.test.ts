/**
 * The editor's source-question state (ADR-0095): whether the sheet is open, and the answer the cook gave. A command reads it
 * when it runs, a render reads it live, so it is a store and not render state.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it, vi } from 'vitest';

import { createStatementStore } from '../statementStore.js';

const authored = {
    statement: { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } },
    visibility: RecipeVisibility.PUBLIC,
} as const;

describe('createStatementStore', () => {
    it('starts closed with no answer', () => {
        expect(createStatementStore().get()).toEqual({ asking: false, answer: undefined });
    });

    it('opens and closes the ask without losing an answer', () => {
        const store = createStatementStore();

        store.answer(authored);
        store.ask(true);
        store.ask(false);

        expect(store.get()).toEqual({ asking: false, answer: authored });
    });

    it('an answer closes the ask', () => {
        const store = createStatementStore();

        store.ask(true);
        store.answer(authored);

        expect(store.get()).toEqual({ asking: false, answer: authored });
    });

    it('tells a subscriber on a change, and not after it unsubscribes', () => {
        const store = createStatementStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.ask(true);
        unsubscribe();
        store.ask(false);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('hands useSyncExternalStore the same snapshot until something changes', () => {
        const store = createStatementStore();
        const before = store.get();

        store.ask(false);

        expect(store.get()).toBe(before);
    });
});

describe('createStatementStore: the Source row’s own answer (ADR-0100)', () => {
    const book = {
        statement: {
            kind: 'book',
            citation: 'The Sunday Roast Book',
            wording: { version: 'statementBook.v2', locale: 'en' },
        },
        locks: true,
    } as const;

    it('holds a row answer apart from the publish answer, and a clear is an answer too', () => {
        const store = createStatementStore();

        store.rowAnswer(book);
        expect(store.get().row).toEqual(book);
        expect(store.get().answer).toBeUndefined();

        store.rowAnswer({ statement: null, locks: false });
        expect(store.get().row).toEqual({ statement: null, locks: false });
    });

    it('forgets the row answer without touching the publish answer', () => {
        const store = createStatementStore();

        store.answer(authored);
        store.rowAnswer(book);
        store.clearRow();

        expect(store.get()).toMatchObject({ answer: authored, row: undefined });
    });

    it('tells a subscriber when the row answer changes', () => {
        const store = createStatementStore();
        const listener = vi.fn();

        store.subscribe(listener);
        store.rowAnswer(book);
        store.clearRow();

        expect(listener).toHaveBeenCalledTimes(2);
    });
});
