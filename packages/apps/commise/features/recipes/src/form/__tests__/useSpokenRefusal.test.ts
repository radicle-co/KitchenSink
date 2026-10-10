// @vitest-environment jsdom
/**
 * Tests for {@link useSpokenRefusal}: native's R7 channel (`docs/design/rowEditorOpenDecisions.md` R7, R8). Native has
 * no `aria-describedby`, so the field a refused save points at says its row sentence in its own assertive alert: the
 * sentence as it stood at the refusal, set once the field has taken focus, said again at each later refusal, and
 * dropped at the cook's next keystroke.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { seedLineKey } from '../lineKey.js';
import { useSpokenRefusal, type RefusalChannel } from '../useSpokenRefusal.js';

const A = seedLineKey(1, 0);
const B = seedLineKey(1, 1);
const SENTENCE = '“smoked flour” isn’t added yet. Choose a food, or clear the box.';

/** An entry field's input as the shared field group hands it over: no refusal said, and its own handlers. */
const fieldInput = (listRequested: boolean): RefusalChannel & { readonly id: string } => ({
    id: 'kept',
    refusal: undefined,
    refusalOccurrence: 0,
    listRequested,
    onFocusRequestHandled: vi.fn(),
    onTextChange: vi.fn(),
});

/** Render the hook at `pendingRefusals` refusals, which a test can raise. */
const renderSpeech = (pendingRefusals = 1) =>
    renderHook((count: number) => useSpokenRefusal(count), { initialProps: pendingRefusals });

describe('useSpokenRefusal', () => {
    it('says nothing, and keeps the field’s own input, before a refused field takes focus', () => {
        const { result } = renderSpeech();
        const input = fieldInput(true);
        const spoken = result.current(input, A, SENTENCE);

        expect(spoken).toMatchObject({ id: 'kept', refusal: undefined, refusalOccurrence: 0, listRequested: true });
    });

    it('once the field a refusal points at takes focus, it says the sentence, at that moment’s refusal count', () => {
        const { result, rerender } = renderSpeech(2);
        const input = fieldInput(true);

        act(() => result.current(input, A, SENTENCE).onFocusRequestHandled());

        expect(input.onFocusRequestHandled).toHaveBeenCalledTimes(1);
        expect(result.current(fieldInput(false), A, SENTENCE)).toMatchObject({
            refusal: SENTENCE,
            refusalOccurrence: 2,
        });

        rerender(3);

        expect(result.current(fieldInput(false), A, SENTENCE).refusalOccurrence).toBe(2);
        expect(result.current(fieldInput(false), B, SENTENCE)).toMatchObject({
            refusal: undefined,
            refusalOccurrence: 0,
        });
    });

    it.each([
        ['a focus no refusal points at', false, SENTENCE],
        ['a field with no sentence to say', true, undefined],
    ] as const)('says nothing after %s', (_case, listRequested, sentence) => {
        const { result } = renderSpeech();
        const input = fieldInput(listRequested);

        act(() => result.current(input, A, sentence).onFocusRequestHandled());

        expect(input.onFocusRequestHandled).toHaveBeenCalledTimes(1);
        expect(result.current(fieldInput(false), A, SENTENCE).refusal).toBeUndefined();
    });

    it('drops the sentence at the cook’s next keystroke in that field, and keeps it through another field’s', () => {
        const { result } = renderSpeech();

        act(() => result.current(fieldInput(true), A, SENTENCE).onFocusRequestHandled());

        const other = fieldInput(false);

        act(() => result.current(other, B, SENTENCE).onTextChange());

        expect(other.onTextChange).toHaveBeenCalledTimes(1);
        expect(result.current(fieldInput(false), A, SENTENCE).refusal).toBe(SENTENCE);

        const own = fieldInput(false);

        act(() => result.current(own, A, SENTENCE).onTextChange());

        expect(own.onTextChange).toHaveBeenCalledTimes(1);
        expect(result.current(fieldInput(false), A, SENTENCE)).toMatchObject({
            refusal: undefined,
            refusalOccurrence: 0,
        });
    });

    it('says nothing once the field no longer has a sentence, though its count stands', () => {
        const { result } = renderSpeech();

        act(() => result.current(fieldInput(true), A, SENTENCE).onFocusRequestHandled());

        expect(result.current(fieldInput(false), A, undefined)).toMatchObject({
            refusal: undefined,
            refusalOccurrence: 1,
        });
    });

    it('speaks for the trailing field by its own key, which no row’s key spells', () => {
        const { result } = renderSpeech();

        act(() => result.current(fieldInput(true), 'newLine', SENTENCE).onFocusRequestHandled());

        expect(result.current(fieldInput(false), 'newLine', SENTENCE).refusal).toBe(SENTENCE);
        expect(result.current(fieldInput(false), A, SENTENCE).refusal).toBeUndefined();
    });
});
