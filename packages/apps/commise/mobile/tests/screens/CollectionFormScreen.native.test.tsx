/**
 * Component tests for the mobile CollectionFormScreen (react-native-web under jsdom, T073). The screen owns
 * the editable name and drives the shared native `CollectionForm`, wiring submit to (mocked)
 * `useCreateCollection` (create) or `useUpdateCollection` (rename). Covers both modes' chrome and submit
 * wiring, including the seeded rename name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCreateCollection, useUpdateCollection } from '@kitchensink/recipe-service-client/hooks';

import { CollectionFormScreen } from '../../src/screens/CollectionFormScreen.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useCreateCollection: vi.fn(),
    useUpdateCollection: vi.fn(),
}));

const useCreateCollectionMock = vi.mocked(useCreateCollection);
const useUpdateCollectionMock = vi.mocked(useUpdateCollection);

function mutation<T>(overrides: Partial<T> = {}): T {
    return { mutate: vi.fn(), isPending: false, isError: false, ...overrides } as unknown as T;
}

afterEach(cleanup);

beforeEach(() => {
    useCreateCollectionMock.mockReset();
    useUpdateCollectionMock.mockReset();
    useCreateCollectionMock.mockReturnValue(mutation<ReturnType<typeof useCreateCollection>>());
    useUpdateCollectionMock.mockReturnValue(mutation<ReturnType<typeof useUpdateCollection>>());
});

describe('CollectionFormScreen — create', () => {
    it('creates a collection with the entered name and navigates away on success', () => {
        const mutate = vi.fn((_request: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useCreateCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useCreateCollection>>({ mutate: mutate as never }),
        );
        const onDone = vi.fn();

        render(<CollectionFormScreen mode="create" onDone={onDone} onCancel={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'New collection' })).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Brunch' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(mutate).toHaveBeenCalledWith(
            { name: 'Brunch' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionFormScreen — rename', () => {
    it('seeds the current name and updates the collection on submit', () => {
        const mutate = vi.fn((_vars: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
        useUpdateCollectionMock.mockReturnValue(
            mutation<ReturnType<typeof useUpdateCollection>>({ mutate: mutate as never }),
        );
        const onDone = vi.fn();

        render(
            <CollectionFormScreen
                mode="rename"
                collectionId="col_1"
                initialName="Weeknight favourites"
                onDone={onDone}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Rename collection' })).toBeTruthy();
        expect((screen.getByLabelText('Collection name') as HTMLInputElement).value).toBe('Weeknight favourites');

        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Weeknight wins' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mutate).toHaveBeenCalledWith(
            { id: 'col_1', request: { name: 'Weeknight wins' } },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});
