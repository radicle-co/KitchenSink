/**
 * `PreventLeave` — the editor route's guard against leaving with a photo not uploaded yet (staff-ux SPECIFY and
 * staff-architect BLUEPRINT 2026-11-10). React Navigation's `usePreventRemove` catches every way off the screen: ×
 * (`goBack`), Android Back, the header and the iOS edge swipe. The adapter's contract, pinned here over a doubled
 * navigator: it prevents exactly while asked to, hands the blocked leave to the editor's ask, and the ask's "Leave"
 * replays the very action that was blocked. That the swipe really is held is a device question (a Maestro flow).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render } from '@commise/ui/testing/tamagui';

/** What `usePreventRemove` hands its callback, narrowed to the field the adapter reads. */
interface BlockedLeave {
    readonly data: { readonly action: object };
}

const { preventRemoveMock, dispatchMock } = vi.hoisted(() => ({
    preventRemoveMock: vi.fn<(when: boolean, callback: (event: BlockedLeave) => void) => void>(),
    dispatchMock: vi.fn<(action: object) => void>(),
}));

vi.mock('@react-navigation/native', () => ({
    usePreventRemove: preventRemoveMock,
    useNavigation: () => ({ dispatch: dispatchMock }),
}));

import { PreventLeave } from '../../src/navigation/PreventLeave.js';

afterEach(() => {
    cleanup();
    preventRemoveMock.mockReset();
    dispatchMock.mockReset();
});

describe('PreventLeave', () => {
    it.each([true, false])('prevents leaving exactly while asked to (%s)', (when) => {
        render(<PreventLeave when={when} onBlocked={vi.fn()} />);

        expect(preventRemoveMock).toHaveBeenCalledWith(when, expect.any(Function));
    });

    it('hands a blocked leave to the ask, and its proceed replays the blocked action, once', () => {
        const onBlocked = vi.fn<(proceed: () => void) => void>();
        const action = { type: 'GO_BACK' };
        render(<PreventLeave when onBlocked={onBlocked} />);

        preventRemoveMock.mock.lastCall?.[1]({ data: { action } });

        expect(onBlocked).toHaveBeenCalledOnce();
        expect(dispatchMock).not.toHaveBeenCalled();

        onBlocked.mock.lastCall?.[0]();

        expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(action);
    });
});
