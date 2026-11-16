/**
 * `useLineEditorState` — the row editor's view state, now with a restore point and an arrival.
 *
 * What these prove: `open` captures a restore point (the memento and whether the range was shown) that `close` drops;
 * an `initialKey` opens that row ONCE, from the lazy initialiser, so a close followed by a re-render never reopens it;
 * an `initialKey` no line holds opens nothing.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withLineKeys } from '../../__fixtures__/index.js';
import { captureLineFields } from '../lineFieldsMemento.js';
import { seedLineKey } from '../lineKey.js';
import { useLineEditorState } from '../useLineEditorState.js';

const lines = withLineKeys([
    { ingredientId: 'ing_a', quantity: 1, unit: 'cup', isUserEntered: false },
    { ingredientId: 'ing_b', quantity: 2, isUserEntered: false },
]);

describe('useLineEditorState restore point', () => {
    it('captures the line as it was when the editor opened, and drops it on close', () => {
        const { result } = renderHook(() => useLineEditorState(lines));

        expect(result.current.restorePoint(lines[0]!.key)).toBeUndefined();

        act(() => result.current.open(lines[0]!.key));

        expect(result.current.restorePoint(lines[0]!.key)).toEqual({
            memento: captureLineFields(lines[0]!),
            rangeShown: false,
        });
        expect(result.current.restorePoint(lines[1]!.key)).toBeUndefined();

        act(() => result.current.close());

        expect(result.current.restorePoint(lines[0]!.key)).toBeUndefined();
    });

    it('records that the range was shown at open', () => {
        const { result } = renderHook(() => useLineEditorState(lines));

        act(() => result.current.showRange(lines[0]!.key));
        act(() => result.current.open(lines[0]!.key));

        expect(result.current.restorePoint(lines[0]!.key)?.rangeShown).toBe(true);
    });

    it('opening another row replaces the restore point', () => {
        const { result } = renderHook(() => useLineEditorState(lines));

        act(() => result.current.open(lines[0]!.key));
        act(() => result.current.open(lines[1]!.key));

        expect(result.current.restorePoint(lines[0]!.key)).toBeUndefined();
        expect(result.current.restorePoint(lines[1]!.key)?.memento).toEqual(captureLineFields(lines[1]!));
    });
});

describe('useLineEditorState arrival', () => {
    it('opens the initial row, with a restore point', () => {
        const { result } = renderHook(() => useLineEditorState(lines, lines[1]!.key));

        expect(result.current.openKey).toBe(lines[1]!.key);
        expect(result.current.restorePoint(lines[1]!.key)).toBeDefined();
    });

    it('opens nothing for a key no line holds', () => {
        const { result } = renderHook(() => useLineEditorState(lines, seedLineKey(9, 9)));

        expect(result.current.openKey).toBeUndefined();
    });

    it('does not reopen after a close and a re-render', () => {
        const { result, rerender } = renderHook(() => useLineEditorState(lines, lines[0]!.key));

        act(() => result.current.close());
        rerender();
        rerender();

        expect(result.current.openKey).toBeUndefined();
    });
});
