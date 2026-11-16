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
