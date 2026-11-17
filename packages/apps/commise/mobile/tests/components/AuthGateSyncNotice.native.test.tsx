/**
 * The sync and unreadable-work notices on MOBILE (react-native-web under jsdom).
 *
 * ⛔ MOBILE MOUNTED NO `SyncNoticeHost` AT ALL until now (`specSharedSystem.md` §17, `offlineNotice.md` §7): no file
 * under `mobile/src` imported it, so a cook offline on a phone was told nothing while web told them. The host is a sibling
 * ABOVE the navigator, inside the signed-in branch of `AuthGate`, so both notices render here and neither renders on the
 * signed-out surfaces, where there is no cook and no queue.
 */
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useContext, type JSX } from 'react';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncProvider, useSyncQueue } from '@commise/query/sync';
import { appendToQuarantine, createMemoryOutboxStore, storeKeyFor } from '@kitchensink/sync';

import { AuthGate } from '../../src/components/AuthGate.js';
import { ReportFocusedRootRouteContext } from '../../src/navigation/focusedRootRoute.js';
import { useAuth } from '../../src/hooks/useAuth.js';
import { render } from '@commise/ui/testing/tamagui';

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/screens/login', () => ({ LoginScreen: () => <Text>stub-login</Text> }));
vi.mock('../../src/screens/signup', () => ({ SignUpScreen: () => <Text>stub-signup</Text> }));
vi.mock('../../src/screens/CompleteSignUpScreen', () => ({ CompleteSignUpScreen: () => <Text>stub-complete</Text> }));

const useAuthMock = vi.mocked(useAuth);

const TITLE = 'Some work on this device couldn’t be opened';

function signedIn(): void {
    useAuthMock.mockReturnValue({
        state: { status: 'authenticated', userId: 'user_a' },
        getToken: vi.fn(),
        signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
}

function app(store = createMemoryOutboxStore()): ReturnType<typeof render> {
    return render(
        <SyncProvider subject="user_a" send={vi.fn()} store={store}>
            <AuthGate>
                <Text>app</Text>
            </AuthGate>
        </SyncProvider>,
    );
}

beforeEach(signedIn);
afterEach(() => {
    cleanup();
    act(() => {
        onlineManager.setOnline(true);
    });
});

describe('AuthGate — the notices on mobile', () => {
    it('shows no notice when online and nothing was set aside, and still renders the app', () => {
        app();

        expect(screen.getByText('app')).toBeTruthy();
        expect(screen.queryByText('You’re offline')).toBeNull();
        expect(screen.queryByText(TITLE)).toBeNull();
    });

    it('⛔ shows the offline notice above the app: mobile had none', () => {
        act(() => {
            onlineManager.setOnline(false);
        });
        app();

        const offline = screen.getByText('You’re offline');
        const content = screen.getByText('app');

        expect(offline.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('⛔ shows the unreadable-work notice when the load set the outbox aside, and Dismiss removes it', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem(storeKeyFor('user_a'), '{ not json');
        app(store);

        await waitFor(() => {
            expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(screen.queryByText(TITLE)).toBeNull();
    });

    it('shows it when the editor`s draft store sets drafts aside after the app is up', async () => {
        const store = createMemoryOutboxStore();
        app(store);

        await act(async () => {
            await appendToQuarantine(store, 'user_a', 'editor.draft.quarantine.user_a', 'bytes');
        });

        expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
    });

    it('⛔ shows both, the unreadable card above the offline notice', async () => {
        act(() => {
            onlineManager.setOnline(false);
        });
        const store = createMemoryOutboxStore();
        await appendToQuarantine(store, 'user_a', 'editor.draft.quarantine.user_a', 'bytes');
        app(store);

        const unreadable = screen.getByText(TITLE);
        const offline = screen.getByText('You’re offline');

        expect(unreadable.compareDocumentPosition(offline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('⛔ shows nothing on a reload that set nothing aside, though an old quarantine key is on the device', async () => {
        const store = createMemoryOutboxStore();
        await store.setItem('sync.outbox.quarantine.user_a', JSON.stringify(['from an earlier launch']));
        app(store);

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.queryByText(TITLE)).toBeNull();
    });

    it('mounts no notice on the signed-out surfaces', () => {
        useAuthMock.mockReturnValue({
            state: { status: 'unauthenticated' },
            getToken: vi.fn(),
            signOut: vi.fn(),
        } as unknown as ReturnType<typeof useAuth>);
        act(() => {
            onlineManager.setOnline(false);
        });
        app();

        expect(screen.getByText('stub-login')).toBeTruthy();
        expect(screen.queryByText('You’re offline')).toBeNull();
    });
});

describe('AuthGate — the cooking form of the notice', () => {
    const BODY = 'Anything you change is saved on this device and syncs when you’re back online.';

    /** Stands in for the navigator: it reports the focused root route through the gate's context. */
    function Navigator(): JSX.Element {
        const report = useContext(ReportFocusedRootRouteContext);

        return (
            <>
                <Text onPress={() => report('CookingMode')}>open cooking</Text>
                <Text onPress={() => report('Tabs')}>open tabs</Text>
            </>
        );
    }

    function offlineApp(): void {
        act(() => {
            onlineManager.setOnline(false);
        });
        render(
            <SyncProvider subject="user_a" send={vi.fn()} store={createMemoryOutboxStore()}>
                <AuthGate>
                    <Navigator />
                </AuthGate>
            </SyncProvider>,
        );
    }

    it('shows the app form on the tabs, with its body', () => {
        offlineApp();

        expect(screen.getAllByText('You’re offline')).toHaveLength(1);
        expect(screen.getByText(BODY)).toBeTruthy();
    });

    it('⛔ shows exactly one notice, title only, while the cooking task is focused', () => {
        offlineApp();

        fireEvent.click(screen.getByText('open cooking'));

        expect(screen.getAllByText('You’re offline')).toHaveLength(1);
        expect(screen.queryByText(BODY)).toBeNull();
    });

    it('brings the app form back on leaving cooking, with its body', () => {
        offlineApp();
        fireEvent.click(screen.getByText('open cooking'));

        fireEvent.click(screen.getByText('open tabs'));

        expect(screen.getAllByText('You’re offline')).toHaveLength(1);
        expect(screen.getByText(BODY)).toBeTruthy();
    });

    it('⛔ does not announce the title again when the form switches: the same text node stays', () => {
        offlineApp();
        const title = screen.getByText('You’re offline');

        fireEvent.click(screen.getByText('open cooking'));
        expect(screen.getByText('You’re offline')).toBe(title);

        fireEvent.click(screen.getByText('open tabs'));
        expect(screen.getByText('You’re offline')).toBe(title);
    });

    it('⛔ hides "Back online" and the syncing line while cooking, and shows them again in the app form', async () => {
        // One write is pending, and its send never resolves, so reconnecting leaves it syncing: the app form says so.
        const send = vi.fn(() => new Promise<never>(() => undefined));

        const Writer = (): JSX.Element => {
            const queue = useSyncQueue();

            return (
                <Text
                    onPress={() => {
                        void queue.submit({
                            entity: 'recipe',
                            intentKind: 'update',
                            localId: 'r1',
                            dependsOn: [],
                            payload: {},
                        });
                    }}
                >
                    save a change
                </Text>
            );
        };

        act(() => {
            onlineManager.setOnline(false);
        });
        render(
            <SyncProvider subject="user_a" send={send} store={createMemoryOutboxStore()}>
                <AuthGate>
                    <Navigator />
                    <Writer />
                </AuthGate>
            </SyncProvider>,
        );
        await act(async () => {
            fireEvent.click(screen.getByText('save a change'));
        });
        fireEvent.click(screen.getByText('open cooking'));

        await act(async () => {
            onlineManager.setOnline(true);
        });

        expect(send).toHaveBeenCalled();
        expect(screen.queryByText('Back online')).toBeNull();
        expect(screen.queryByText(/Syncing/u)).toBeNull();

        fireEvent.click(screen.getByText('open tabs'));

        expect(screen.getByText('Back online')).toBeTruthy();
        expect(screen.getByText('Syncing 1 change…')).toBeTruthy();
    });
});
