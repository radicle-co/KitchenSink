/**
 * The cook-marks store over its storage port (blueprint A13). Marks are keyed by (cook, recipe), not by screen: a
 * recipe open twice shows ONE set of marks. A read is reference-stable while nothing changed, as
 * `useSyncExternalStore` requires. At a change of cook the previous cook's marks are REMOVED from storage — re-keying
 * alone would leave them at rest — and a cook signing in from "not known yet" removes only other cooks' marks.
 */
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_COOK_MARKS } from '../cookMarks.js';
import { createCookMarksStore, memoryCookMarksBackend } from '../cookMarksStore.js';
import { tickKeyOf } from '../__fixtures__/tickKeys.js';

const [ING_A, ING_B] = [1, 2].map(tickKeyOf);

describe('createCookMarksStore', () => {
    it('reads no marks for an untouched recipe, the same object each time', () => {
        const store = createCookMarksStore(memoryCookMarksBackend());

        expect(store.read('user_1', 'rec_1')).toBe(EMPTY_COOK_MARKS);
        expect(store.read('user_1', 'rec_1')).toBe(store.read('user_1', 'rec_1'));
    });

    it('keeps marks per recipe, and the snapshot stable until the next change', () => {
        const store = createCookMarksStore(memoryCookMarksBackend());

        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        const first = store.read('user_1', 'rec_1');

        expect([...first.lines]).toEqual([ING_A]);
        expect(store.read('user_1', 'rec_1')).toBe(first);
        expect(store.read('user_1', 'rec_2')).toBe(EMPTY_COOK_MARKS);

        store.dispatch('user_1', 'rec_1', { kind: 'toggleStep', step: 2 });
        expect(store.read('user_1', 'rec_1')).not.toBe(first);
        expect(store.read('user_1', 'rec_1').currentStep).toBe(2);
    });

    it('keeps one cook’s marks from another cook on the same recipe', () => {
        const store = createCookMarksStore(memoryCookMarksBackend());

        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });

        expect(store.read('user_2', 'rec_1')).toBe(EMPTY_COOK_MARKS);
    });

    it('writes the stored form under the namespaced key, and removes it when no mark is left', () => {
        const backend = memoryCookMarksBackend();
        const store = createCookMarksStore(backend);

        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        expect(backend.getItem('cook.v1.user_1.rec_1')).toBe(`{"lines":["${ING_A}"],"step":null}`);

        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        expect(backend.getItem('cook.v1.user_1.rec_1')).toBeNull();
    });

    it('reads marks a previous page life left in storage', () => {
        const backend = memoryCookMarksBackend();
        backend.setItem('cook.v1.user_1.rec_1', `{"lines":["${ING_B}"],"step":3}`);

        const marks = createCookMarksStore(backend).read('user_1', 'rec_1');

        expect([...marks.lines]).toEqual([ING_B]);
        expect(marks.currentStep).toBe(3);
    });

    it('notifies subscribers on a change, and not on a clear that changes nothing', () => {
        const store = createCookMarksStore(memoryCookMarksBackend());
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.dispatch('user_1', 'rec_1', { kind: 'clear' });
        expect(listener).not.toHaveBeenCalled();

        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('the session scope', () => {
    it('removes every mark when the cook signs out', () => {
        const backend = memoryCookMarksBackend();
        const store = createCookMarksStore(backend);
        store.scope('user_1');
        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        backend.setItem('editor.draft.v1.user_1', 'kept');

        store.scope(undefined);

        expect(backend.getItem('cook.v1.user_1.rec_1')).toBeNull();
        expect(store.read('user_1', 'rec_1')).toBe(EMPTY_COOK_MARKS);
        expect(backend.getItem('editor.draft.v1.user_1')).toBe('kept');
    });

    it('removes the previous cook’s marks when another cook signs in, and keeps the new cook’s own', () => {
        const backend = memoryCookMarksBackend();
        backend.setItem('cook.v1.user_1.rec_1', `{"lines":["${ING_A}"],"step":null}`);
        backend.setItem('cook.v1.user_2.rec_1', `{"lines":["${ING_B}"],"step":null}`);
        const store = createCookMarksStore(backend);

        store.scope('user_2');

        expect(backend.getItem('cook.v1.user_1.rec_1')).toBeNull();
        expect([...store.read('user_2', 'rec_1').lines]).toEqual([ING_B]);
    });

    it('removes nothing while the cook is not known yet (a page still loading its session)', () => {
        const backend = memoryCookMarksBackend();
        backend.setItem('cook.v1.user_1.rec_1', `{"lines":["${ING_A}"],"step":null}`);
        const store = createCookMarksStore(backend);

        store.scope(undefined);

        expect(backend.getItem('cook.v1.user_1.rec_1')).not.toBeNull();
    });

    it('tells subscribers when it removed marks', () => {
        const store = createCookMarksStore(memoryCookMarksBackend());
        store.scope('user_1');
        store.dispatch('user_1', 'rec_1', { kind: 'toggleLine', line: ING_A });
        const listener = vi.fn();
        store.subscribe(listener);

        store.scope(undefined);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
