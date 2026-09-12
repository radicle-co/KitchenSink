// @vitest-environment jsdom
/**
 * Tests for {@link useRowFocus}: where focus goes next in the ingredients field group (§2d;
 * `docs/design/rowEditorOpenDecisions.md` items 1, 4, 8 and 11, R7), shared by the web and native leaves. Each request
 * is a level a control lowers once it has taken focus; where a request comes from is `rowFocus.ts`'s pure rules.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeIngredientEntry, makeIngredientRowEditor } from '../../__fixtures__/index.js';
import type { LineCommitTarget } from '../../hooks/lineCommit.js';
import type { IngredientRowEditor, RowCommitOrigin, SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { seedLineKey } from '../lineKey.js';
import { useRowFocus } from '../useRowFocus.js';

const A = seedLineKey(1, 0);
const B = seedLineKey(1, 1);
const APPENDED = seedLineKey(1, 2);

/** A commit that settled from `origin` on `target`, committed unless `outcome` says otherwise. */
const settledFrom = (
    origin: RowCommitOrigin,
    target: LineCommitTarget,
    outcome: SettledRowCommit['outcome'] = {
        kind: 'committed',
        key: target.kind === 'line' ? target.key : APPENDED,
        binding: { ingredientId: 'ing_kale', isUserEntered: false },
    },
): SettledRowCommit => ({ origin, target, outcome, pick: { kind: 'catalogFood', foodId: 'food_kale', name: 'Kale' } });

/** A row editor whose R7 refusal points at `pendingAt`, if given. */
const editorWith = (over: Partial<IngredientRowEditor> = {}, pendingAt?: LineCommitTarget): IngredientRowEditor =>
    makeIngredientRowEditor({
        ...over,
        ...(pendingAt === undefined
            ? {}
            : {
                  pendingFocusRequested: true,
                  entry: makeIngredientEntry({ pending: { target: pendingAt, text: 'smoked flour' } }),
              }),
    });

/** Render the hook over an editor the test can replace between renders. */
const renderFocus = (initial: IngredientRowEditor) =>
    renderHook((editor: IngredientRowEditor) => useRowFocus(editor), { initialProps: initial });

describe('useRowFocus — at rest', () => {
    it('asks no control to take focus', () => {
        const { result } = renderFocus(editorWith());

        expect(result.current.name(A)).toMatchObject({ requested: false, listRequested: false });
        expect(result.current.glyph(A).requested).toBe(false);
        expect(result.current.actions(A).requested).toBe(false);
        expect(result.current.trailing).toMatchObject({ requested: false, listRequested: false });
    });
});

describe('useRowFocus — a request', () => {
    it.each(['name', 'glyph', 'actions'] as const)('asks THAT row’s %s alone, until it reports focus', (control) => {
        const { result } = renderFocus(editorWith());

        act(() => result.current.request(A, control));

        expect(result.current[control](A).requested).toBe(true);
        expect(result.current[control](B).requested).toBe(false);

        for (const other of (['name', 'glyph', 'actions'] as const).filter((each) => each !== control)) {
            expect(result.current[other](A).requested).toBe(false);
        }

        act(() => result.current[control](A).onHandled());

        expect(result.current[control](A).requested).toBe(false);
    });

    it('a name field lowers only a request for itself, so another row’s request outlives it', () => {
        const { result } = renderFocus(editorWith());

        act(() => result.current.request(B, 'glyph'));
        act(() => result.current.name(A).onHandled());

        expect(result.current.glyph(B).requested).toBe(true);
    });

    it('the glyph and ⋮ lower whatever request stands when they report focus', () => {
        const { result } = renderFocus(editorWith());

        act(() => result.current.request(B, 'name'));
        act(() => result.current.glyph(A).onHandled());

        expect(result.current.name(B).requested).toBe(false);

        act(() => result.current.request(B, 'name'));
        act(() => result.current.actions(A).onHandled());

        expect(result.current.name(B).requested).toBe(false);
    });

    it('the trailing field, until it reports focus (V1 sign-off item 11)', () => {
        const { result } = renderFocus(editorWith());

        act(() => result.current.requestTrailing());

        expect(result.current.trailing).toMatchObject({ requested: true, listRequested: false });

        act(() => result.current.trailing.onHandled());

        expect(result.current.trailing.requested).toBe(false);
    });
});

describe('useRowFocus — a refused save points at the pending field (R7)', () => {
    it('a row’s field takes focus with its list open, and taking it lowers the refusal’s level', () => {
        const pendingFocusHandled = vi.fn();
        const { result } = renderFocus(editorWith({ pendingFocusHandled }, { kind: 'line', key: B }));

        expect(result.current.name(B)).toMatchObject({ requested: true, listRequested: true });
        expect(result.current.name(A)).toMatchObject({ requested: false, listRequested: false });
        expect(result.current.trailing.requested).toBe(false);

        act(() => result.current.name(A).onHandled());
        expect(pendingFocusHandled).not.toHaveBeenCalled();

        act(() => result.current.name(B).onHandled());
        expect(pendingFocusHandled).toHaveBeenCalledTimes(1);
    });

    it('the trailing field takes focus with its list open, and taking it lowers the refusal’s level', () => {
        const pendingFocusHandled = vi.fn();
        const { result } = renderFocus(editorWith({ pendingFocusHandled }, { kind: 'newLine' }));

        expect(result.current.trailing).toMatchObject({ requested: true, listRequested: true });
        expect(result.current.name(A).requested).toBe(false);

        act(() => result.current.trailing.onHandled());

        expect(pendingFocusHandled).toHaveBeenCalledTimes(1);
    });

    it('asks nothing while the refusal is not pointing, even with text pending', () => {
        const { result } = renderFocus(
            makeIngredientRowEditor({
                pendingFocusRequested: false,
                entry: makeIngredientEntry({ pending: { target: { kind: 'line', key: B }, text: 'smoked flour' } }),
            }),
        );

        expect(result.current.name(B).requested).toBe(false);
    });
});

describe('useRowFocus — a commit that settles (§2d, item 1)', () => {
    it.each<[string, SettledRowCommit, 'glyph' | 'trailing' | 'none']>([
        ['an entry pick on a row: its glyph, now', settledFrom({ kind: 'entry' }, { kind: 'line', key: A }), 'glyph'],
        [
            'an entry pick on the trailing row: the trailing field, now (the F1 loop)',
            settledFrom({ kind: 'entry' }, { kind: 'newLine' }),
            'trailing',
        ],
        [
            'a details pick: nothing, its dialog returns focus to ⋮',
            settledFrom({ kind: 'details', mode: 'add' }, { kind: 'line', key: A }),
            'none',
        ],
        [
            'a shortlist pick: nothing, its panel returns focus to the glyph',
            settledFrom({ kind: 'shortlist' }, { kind: 'line', key: A }),
            'none',
        ],
        [
            'a pick that failed: nothing',
            settledFrom({ kind: 'entry' }, { kind: 'line', key: A }, { kind: 'failed' }),
            'none',
        ],
    ])('%s', (_case, settled, expected) => {
        const { result, rerender } = renderFocus(editorWith());

        rerender(editorWith({ settled }));

        expect(result.current.glyph(A).requested).toBe(expected === 'glyph');
        expect(result.current.trailing.requested).toBe(expected === 'trailing');
    });

    it('reacts to each commit once, never to the one standing at mount', () => {
        const settled = settledFrom({ kind: 'entry' }, { kind: 'line', key: A });
        const { result, rerender } = renderFocus(editorWith({ settled }));

        expect(result.current.glyph(A).requested).toBe(false);

        const onB = settledFrom({ kind: 'entry' }, { kind: 'line', key: B });

        rerender(editorWith({ settled: onB }));
        expect(result.current.glyph(B).requested).toBe(true);

        act(() => result.current.glyph(B).onHandled());
        rerender(editorWith({ settled: onB }));

        expect(result.current.glyph(B).requested).toBe(false);
    });

    it('an authored food moves focus to its row’s glyph only once its Sheet has gone, and only once', () => {
        const { result, rerender } = renderFocus(editorWith());

        rerender(
            editorWith({
                settled: settledFrom({ kind: 'authoredFood', outcome: 'created' }, { kind: 'line', key: A }),
            }),
        );

        expect(result.current.glyph(A).requested).toBe(false);

        let moved = false;

        act(() => {
            moved = result.current.authoredSheetDismissed();
        });

        expect(moved).toBe(true);
        expect(result.current.glyph(A).requested).toBe(true);

        act(() => result.current.glyph(A).onHandled());
        act(() => {
            moved = result.current.authoredSheetDismissed();
        });

        expect(moved).toBe(false);
        expect(result.current.glyph(A).requested).toBe(false);
    });

    it('a Sheet that closes with no success moves nothing', () => {
        const { result } = renderFocus(editorWith());
        let moved = true;

        act(() => {
            moved = result.current.authoredSheetDismissed();
        });

        expect(moved).toBe(false);
        expect(result.current.trailing.requested).toBe(false);
    });
});

describe('useRowFocus — a request that waits for the glyph’s panel (row 6’s None of these)', () => {
    it('moves focus only once THAT row’s panel has gone', () => {
        const { result } = renderFocus(editorWith());

        act(() => result.current.requestAfterGlyphPanel({ key: A, control: 'name' }));

        expect(result.current.name(A).requested).toBe(false);

        act(() => result.current.glyph(B).onPanelDismissed());
        expect(result.current.name(A).requested).toBe(false);

        act(() => result.current.glyph(A).onPanelDismissed());
        expect(result.current.name(A).requested).toBe(true);

        act(() => result.current.name(A).onHandled());
        act(() => result.current.glyph(A).onPanelDismissed());
        expect(result.current.name(A).requested).toBe(false);
    });
});
