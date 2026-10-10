// @vitest-environment jsdom
/**
 * The conflict view's local statechart and its gates (`useConflictView`), which both `RecipeConflictView` leaves draw:
 * the merge panel's toggle, the stale-base confirmation (W7 Task 5 / X6), the gates on Overwrite and Save merged (X5,
 * X6), the explicit-pick reading of `selections`, and the reset when a NEW conflict arrives on the same instance.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeVersionConflictSide } from '../__fixtures__/index.js';
import type { RecipeConflictViewProps } from '../conflictView.js';
import type { RecipeMergeSelections } from '../merge.js';
import { useConflictView } from '../useConflictView.js';

type HookProps = Pick<
    RecipeConflictViewProps,
    'server' | 'base' | 'versionsBehind' | 'selections' | 'onSelectionsChange'
>;

const fresh = (overrides: Partial<HookProps> = {}): HookProps => ({
    server: makeVersionConflictSide({ versionNumber: 6 }),
    base: makeVersionConflictSide({ versionNumber: 5 }),
    versionsBehind: 1,
    selections: {},
    onSelectionsChange: vi.fn(),
    ...overrides,
});

const render = (props: HookProps) =>
    renderHook((current: HookProps) => useConflictView(current), { initialProps: props });

describe('useConflictView — the gates', () => {
    it.each<[string, Partial<HookProps>, boolean, boolean, boolean]>([
        ['a fresh base, nothing picked', {}, false, false, true],
        ['a fresh base, a side picked', { selections: { title: 'mine' } }, false, false, false],
        ['an evicted base, a side picked', { base: undefined, selections: { title: 'mine' } }, true, true, true],
        [
            'a base too far behind, a side picked',
            { versionsBehind: 11, selections: { title: 'theirs' } },
            true,
            true,
            true,
        ],
        [
            'a base exactly at the limit, a side picked',
            { versionsBehind: 10, selections: { title: 'theirs' } },
            false,
            false,
            false,
        ],
    ])('%s', (_case, overrides, isStale, overwriteBlocked, mergeBlocked) => {
        const { result } = render(fresh(overrides));

        expect(result.current.isStale).toBe(isStale);
        expect(result.current.overwriteBlocked).toBe(overwriteBlocked);
        expect(result.current.mergeBlocked).toBe(mergeBlocked);
    });

    it('confirming a stale base lifts the stale gate, and only the stale gate', () => {
        const { result, rerender } = render(fresh({ base: undefined }));

        act(() => result.current.setStaleConfirmed(true));

        expect(result.current.staleConfirmed).toBe(true);
        expect(result.current.overwriteBlocked).toBe(false);
        // Nothing picked yet: Save merged stays blocked by the selection gate.
        expect(result.current.mergeBlocked).toBe(true);

        rerender(fresh({ base: undefined, selections: { title: 'mine' } }));

        expect(result.current.mergeBlocked).toBe(false);
    });
});

describe('useConflictView — the picks', () => {
    it('reads only explicit picks: an absent key is no side, not a default', () => {
        const selections: RecipeMergeSelections = { title: 'theirs' };
        const { result } = render(fresh({ selections }));

        expect(result.current.hasSelection).toBe(true);
        expect(result.current.sideOf('title')).toBe('theirs');
        expect(result.current.sideOf('servings')).toBeUndefined();
    });

    it('a pick reports the next selections, keeping the others', () => {
        const onSelectionsChange = vi.fn();
        const { result } = render(fresh({ selections: { title: 'theirs' }, onSelectionsChange }));

        act(() => result.current.choose('servings', 'mine'));

        expect(onSelectionsChange).toHaveBeenCalledWith({ title: 'theirs', servings: 'mine' });
    });
});

describe('useConflictView — the merge panel', () => {
    it('opens on Option C, and leaving it clears every pick', () => {
        const onSelectionsChange = vi.fn();
        const { result } = render(fresh({ selections: { title: 'mine' }, onSelectionsChange }));

        expect(result.current.merging).toBe(false);

        act(() => result.current.startMerge());

        expect(result.current.merging).toBe(true);

        act(() => result.current.leaveMerge());

        expect(result.current.merging).toBe(false);
        expect(onSelectionsChange).toHaveBeenCalledWith({});
    });

    it('a NEW conflict on the same instance closes the panel and drops the prior confirmation', () => {
        const { result, rerender } = render(fresh({ base: undefined }));

        act(() => {
            result.current.setStaleConfirmed(true);
            result.current.startMerge();
        });
        rerender(fresh({ base: undefined, server: makeVersionConflictSide({ versionNumber: 7 }) }));

        expect(result.current.merging).toBe(false);
        expect(result.current.staleConfirmed).toBe(false);
        expect(result.current.overwriteBlocked).toBe(true);
    });

    it('a re-render of the SAME conflict keeps both', () => {
        const { result, rerender } = render(fresh({ base: undefined }));

        act(() => {
            result.current.setStaleConfirmed(true);
            result.current.startMerge();
        });
        rerender(fresh({ base: undefined }));

        expect(result.current.merging).toBe(true);
        expect(result.current.staleConfirmed).toBe(true);
    });
});
