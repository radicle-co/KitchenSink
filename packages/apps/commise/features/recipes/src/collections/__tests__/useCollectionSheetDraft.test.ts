/**
 * The collection sheet's draft (`docs/design/uiOverhaul/buildSpec.md` §5.1), the logic both leaves share: an empty name is
 * refused and reported to the leaf; the request is trimmed, with no description when it is blank; closing asks only when
 * there is something to lose; and each time the sheet opens the draft restarts from the collection as it is now.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { COLLECTION_DESCRIPTION_MAX_LENGTH, COLLECTION_NAME_MAX_LENGTH } from '../limits.js';
import type { CollectionSheetProps } from '../sheetModel.js';
import { useCollectionSheetDraft } from '../useCollectionSheetDraft.js';

const base = { open: true, submitting: false, failed: false };

/** A sheet opened to create, with the host's callbacks kept so a test can read them. */
function createSheet(overrides: { readonly open?: boolean; readonly submitting?: boolean } = {}) {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    const props: CollectionSheetProps = { ...base, ...overrides, onOpenChange, onCreate };

    return { props, onCreate, onOpenChange };
}

/** A sheet opened to rename `initial`. */
function renameSheet(
    overrides: { readonly open?: boolean; readonly initial?: { name: string; description?: string } } = {},
) {
    const onRename = vi.fn();
    const onOpenChange = vi.fn();
    const props: CollectionSheetProps = {
        ...base,
        open: overrides.open ?? true,
        onOpenChange,
        intent: 'rename',
        initial: overrides.initial ?? { name: 'Dinners', description: 'Quick' },
        onRename,
    };

    return { props, onRename, onOpenChange };
}

describe('useCollectionSheetDraft', () => {
    it('refuses an empty name, reports it to the leaf, and sends nothing', () => {
        const { props, onCreate } = createSheet();
        const onRefused = vi.fn();
        const { result } = renderHook(() => useCollectionSheetDraft(props));

        act(() => result.current.typeName('   '));
        act(() => result.current.submit(onRefused));

        expect(result.current.nameError).toBe(true);
        expect(onRefused).toHaveBeenCalledTimes(1);
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('clears the refusal as soon as the name is typed again', () => {
        const { result } = renderHook(() => useCollectionSheetDraft(createSheet().props));

        act(() => result.current.submit());
        expect(result.current.nameError).toBe(true);

        act(() => result.current.typeName('S'));

        expect(result.current.nameError).toBe(false);
    });

    it('sends a trimmed request, and leaves the description out when it is blank', () => {
        const { props, onCreate } = createSheet();
        const { result } = renderHook(() => useCollectionSheetDraft(props));

        act(() => result.current.typeName('  Weeknights  '));
        act(() => result.current.typeDescription('   '));
        act(() => result.current.submit());

        expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: 'Weeknights' });
    });

    it('caps the name and the description at their limits', () => {
        const { result } = renderHook(() => useCollectionSheetDraft(createSheet().props));

        act(() => result.current.typeName('n'.repeat(COLLECTION_NAME_MAX_LENGTH + 10)));
        act(() => result.current.typeDescription('d'.repeat(COLLECTION_DESCRIPTION_MAX_LENGTH + 10)));

        expect(result.current.name).toHaveLength(COLLECTION_NAME_MAX_LENGTH);
        expect(result.current.description).toHaveLength(COLLECTION_DESCRIPTION_MAX_LENGTH);
    });

    it('closes at once when nothing was typed, and asks first when a name was', () => {
        const { props, onOpenChange } = createSheet();
        const { result } = renderHook(() => useCollectionSheetDraft(props));

        act(() => result.current.requestClose());
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(result.current.confirming).toBe(false);

        onOpenChange.mockClear();
        act(() => result.current.typeName('Weeknights'));
        act(() => result.current.requestClose());

        expect(result.current.confirming).toBe(true);
        expect(onOpenChange).not.toHaveBeenCalled();

        act(() => result.current.close());
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not ask while a request is in flight', () => {
        const { props } = createSheet({ submitting: true });
        const { result } = renderHook(() => useCollectionSheetDraft(props));

        act(() => result.current.typeName('Weeknights'));
        act(() => result.current.requestClose());

        expect(result.current.confirming).toBe(false);
    });

    it('starts a rename from the collection and counts only a change as something to lose', () => {
        const { props } = renameSheet();
        const { result } = renderHook(() => useCollectionSheetDraft(props));

        expect(result.current.renaming).toBe(true);
        expect(result.current.name).toBe('Dinners');
        expect(result.current.description).toBe('Quick');

        act(() => result.current.requestClose());
        expect(result.current.confirming).toBe(false);

        act(() => result.current.typeName('Weeknights'));
        act(() => result.current.requestClose());
        expect(result.current.confirming).toBe(true);
    });

    it('sends a rename through onRename, not onCreate', () => {
        const { props, onRename } = renameSheet();
        const { result } = renderHook(() => useCollectionSheetDraft(props));

        act(() => result.current.typeName('Weeknights'));
        act(() => result.current.submit());

        expect(onRename).toHaveBeenCalledExactlyOnceWith({
            name: 'Weeknights',
            description: 'Quick',
        });
    });

    it('restarts from the collection as it is NOW each time it opens', () => {
        let { props } = renameSheet({ open: false });
        const { result, rerender } = renderHook(() => useCollectionSheetDraft(props));

        props = renameSheet({ open: false, initial: { name: 'Renamed elsewhere' } }).props;
        rerender();
        props = renameSheet({ open: true, initial: { name: 'Renamed elsewhere' } }).props;
        rerender();

        expect(result.current.name).toBe('Renamed elsewhere');
        expect(result.current.description).toBe('');
    });
});
