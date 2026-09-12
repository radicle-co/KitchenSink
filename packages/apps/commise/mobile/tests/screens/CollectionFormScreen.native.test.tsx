/**
 * Component tests for the mobile CollectionFormScreen (react-native-web under jsdom, T073). The screen owns
 * the editable name and drives the shared native `CollectionForm`, wiring submit to (mocked)
 * `useCreateCollection` (create) or `useUpdateCollection` (rename). Covers both modes' chrome and submit
 * wiring, including the seeded rename name.
 *
 * The discard confirm carries no name of its own: its title header names it (`docs/design/nativeContainerNames.md` N1),
 * so these tests find it by that header.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';
import { useCreateCollection, useUpdateCollection } from '@kitchensink/recipe-service-client/hooks';

import { mobileMessages } from '../../src/i18n/messages.js';
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

const discard = mobileMessages.en.common.discard;

/**
 * The screen installs a hardware-back interceptor, and `useBackIntercept` THROWS without a provider above
 * it — the same wrapper every guarded surface's suite uses (`RecipeCreateScreen.native.test.tsx`).
 *
 * `onUnhandled` answers `false` so a press the screen DECLINED is visible as a decline rather than being
 * absorbed by a fake navigator.
 */
function renderScreen(ui: ReactElement): void {
    render(<BackInterceptProvider onUnhandled={() => false}>{ui}</BackInterceptProvider>);
}

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

        renderScreen(<CollectionFormScreen mode="create" onDone={onDone} onCancel={vi.fn()} />);

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

        renderScreen(
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

/**
 * ⛔ THE SYSTEM BACK BUTTON IS THE SECOND WAY OUT OF THIS FORM, AND IT USED TO BE THE UNGUARDED ONE.
 *
 * `CollectionFormScreen` holds the typed name in its own state and nothing else does, so a press that pops
 * the surface discards it with no way back. The screen's own Cancel control had the same gap. Both exits
 * now ask, through the one guard — which is the property these cases are written to hold: whichever entry
 * point is used, the ANSWER is the same.
 *
 * ⚠️ A device layering this tier cannot see: an open RN `Modal` takes the back event itself before any
 * `BackHandler` subscription is reached. `react-native-web`'s does not, so that belongs to Maestro
 * (`.maestro/recipes/systemBackGuard.yaml`).
 */
describe('CollectionFormScreen — the unsaved-name guard', () => {
    let back: HardwareBackHandle;

    beforeEach(() => {
        back = installHardwareBackHandler();
    });

    afterEach(() => {
        back.restore();
    });

    it('leaves immediately when nothing has been typed — a guard that always asks is a nuisance', () => {
        const onCancel = vi.fn();
        renderScreen(<CollectionFormScreen mode="create" onDone={vi.fn()} onCancel={onCancel} />);

        expect(back.press()).toBe(true);

        expect(screen.queryByRole('heading', { name: discard.title })).toBeNull();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('⛔ asks before discarding a typed name, and does not leave', () => {
        const onCancel = vi.fn();
        renderScreen(<CollectionFormScreen mode="create" onDone={vi.fn()} onCancel={onCancel} />);
        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Brunch' } });

        expect(back.press()).toBe(true);

        expect(screen.getByRole('heading', { name: discard.title })).toBeTruthy();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('⛔ keeps the form AND the typed name when the cook keeps editing', () => {
        const onCancel = vi.fn();
        renderScreen(<CollectionFormScreen mode="create" onDone={vi.fn()} onCancel={onCancel} />);
        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Brunch' } });
        back.press();

        fireEvent.click(screen.getByRole('button', { name: discard.cancel }));

        expect(screen.queryByRole('heading', { name: discard.title })).toBeNull();
        // Asserting only that the dialog closed would pass against a guard that discarded behind it.
        expect(screen.getByLabelText('Collection name')).toHaveProperty('value', 'Brunch');
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('leaves once, and only once, when the cook confirms the discard', () => {
        const onCancel = vi.fn();
        renderScreen(<CollectionFormScreen mode="create" onDone={vi.fn()} onCancel={onCancel} />);
        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Brunch' } });
        back.press();

        fireEvent.click(screen.getByRole('button', { name: discard.confirm }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('heading', { name: discard.title })).toBeNull();
    });

    it("⛔ the form's OWN Cancel reaches the SAME guard — one answer, two entry points", () => {
        const onCancel = vi.fn();
        renderScreen(<CollectionFormScreen mode="create" onDone={vi.fn()} onCancel={onCancel} />);
        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Brunch' } });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.getByRole('heading', { name: discard.title })).toBeTruthy();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('⛔ treats the SEEDED rename name as clean — an untouched rename has nothing to lose', () => {
        const onCancel = vi.fn();
        renderScreen(
            <CollectionFormScreen
                mode="rename"
                collectionId="col_1"
                initialName="Weeknight favourites"
                onDone={vi.fn()}
                onCancel={onCancel}
            />,
        );

        expect(back.press()).toBe(true);
        expect(screen.queryByRole('heading', { name: discard.title })).toBeNull();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('⛔ asks once the seeded rename name has been CHANGED — the positive control for the case above', () => {
        const onCancel = vi.fn();
        renderScreen(
            <CollectionFormScreen
                mode="rename"
                collectionId="col_1"
                initialName="Weeknight favourites"
                onDone={vi.fn()}
                onCancel={onCancel}
            />,
        );
        fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'Weeknight wins' } });

        expect(back.press()).toBe(true);
        expect(screen.getByRole('heading', { name: discard.title })).toBeTruthy();
        expect(onCancel).not.toHaveBeenCalled();
    });
});
