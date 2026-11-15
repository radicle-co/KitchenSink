import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCookingKeepAwake } from '../../src/useCookingKeepAwake.js';
import { useCookingSession } from '../../src/useCookingSession.js';

afterEach(cleanup);

/**
 * The screen-on hold follows the session's status: the real session hook over cooking-core's real reducers drives the
 * status, and only the browser's wake lock is stood in for. Steps 1, 2 and 4 have text; step 3 is blank and skipped.
 */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat the oil. Add the onion.' },
    { stepNumber: 2, instruction: 'Stir until golden.' },
    { stepNumber: 3, instruction: '   ' },
    { stepNumber: 4, instruction: 'Serve it hot.' },
];

const mount = (steps = STEPS) =>
    renderHook(
        (props: { steps: typeof STEPS }) => {
            const session = useCookingSession({ recipeId: 'rec_1', steps: props.steps });

            return { ...session, ...useCookingKeepAwake(session.status) };
        },
        { initialProps: { steps } },
    );

describe('useCookingKeepAwake — the screen stays on while cooking and only then', () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ released: false, release }));

    beforeEach(() => {
        release.mockClear();
        request.mockClear();
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
        // The adapter needs a secure context; jsdom's default page is not one.
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'wakeLock');
        Reflect.deleteProperty(window, 'isSecureContext');
    });

    it('holds a wake lock while cooking and lets go on Done', async () => {
        const { result } = mount();

        await act(async () => undefined);
        expect(request).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();

        act(() => result.current.next());
        act(() => result.current.next());
        await act(async () => undefined);
        expect(release).not.toHaveBeenCalled();

        act(() => result.current.next());
        await act(async () => undefined);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('holds it again after Cook it again', async () => {
        const { result } = mount();

        act(() => result.current.next());
        act(() => result.current.next());
        act(() => result.current.next());
        await act(async () => undefined);
        act(() => result.current.cookAgain());
        await act(async () => undefined);

        expect(request).toHaveBeenCalledTimes(2);
    });

    it('lets go when the cook leaves, which unmounts the screen', async () => {
        const { unmount } = mount();

        await act(async () => undefined);
        unmount();
        await act(async () => undefined);

        expect(release).toHaveBeenCalledTimes(1);
    });

    it('says whether the screen can be kept on, so the shell shows no promise it cannot keep', () => {
        const { result } = mount();

        expect(result.current.keepAwakeAvailable).toBe(true);

        Reflect.deleteProperty(navigator, 'wakeLock');
        expect(mount().result.current.keepAwakeAvailable).toBe(false);
    });
});
