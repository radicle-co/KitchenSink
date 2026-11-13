import { InvalidTotalStepsError } from '@kitchensink/cooking-core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCookingSession } from '../useCookingSession.js';

afterEach(cleanup);

/**
 * The hook holds no rule: every case runs over cooking-core's REAL reducers, splitter and place
 * formatters, with nothing mocked but the browser's wake lock. Steps 1, 2 and 4 have text; step 3 is blank and must be
 * skipped, so the cook walks three steps and step 1 has two lines.
 */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat the oil. Add the onion.' },
    { stepNumber: 2, instruction: 'Stir until golden.' },
    { stepNumber: 3, instruction: '   ' },
    { stepNumber: 4, instruction: 'Serve it hot.' },
];

const mount = (steps = STEPS) =>
    renderHook((props: { steps: typeof STEPS }) => useCookingSession({ recipeId: 'rec_1', steps: props.steps }), {
        initialProps: { steps },
    });

describe('useCookingSession — walking the steps', () => {
    it('opens on step 1, line 1, with nothing ticked, counting only steps with text', () => {
        const { result } = mount();

        // The kept statechart calls a session with no progress `idle`; the screen only asks "complete or not".
        expect(result.current.status).toBe('idle');
        expect(result.current.place).toEqual({ position: 1, total: 3, previous: null, next: 2 });
        expect(result.current.step.lines).toEqual(['Heat the oil.', 'Add the onion.']);
        expect(result.current.focusLine).toBe(0);
        expect(result.current.tickedCount).toBe(0);
        expect(result.current.everyLineTicked).toBe(false);
    });

    it('goes forward and back, and Back on step 1 stays put (the shell leaves to the recipe)', () => {
        const { result } = mount();

        act(() => result.current.back());
        expect(result.current.place.position).toBe(1);

        act(() => result.current.next());
        expect(result.current.place).toEqual({ position: 2, total: 3, previous: 1, next: 3 });
        expect(result.current.step.lines).toEqual(['Stir until golden.']);

        act(() => result.current.next());
        expect(result.current.step.lines).toEqual(['Serve it hot.']);
        expect(result.current.place.next).toBeNull();

        act(() => result.current.back());
        expect(result.current.place.position).toBe(2);
    });

    it('is complete after Next on the last step, and not before', () => {
        const { result } = mount();

        act(() => result.current.next());
        act(() => result.current.next());
        expect(result.current.status).toBe('cooking');

        act(() => result.current.next());
        expect(result.current.status).toBe('complete');
    });

    it('starts again from step 1 with every line tick cleared', () => {
        const { result } = mount();

        act(() => result.current.tick(0));
        act(() => result.current.next());
        act(() => result.current.next());
        act(() => result.current.next());
        expect(result.current.status).toBe('complete');

        act(() => result.current.cookAgain());
        expect(result.current.status).toBe('idle');
        expect(result.current.place.position).toBe(1);
        expect(result.current.tickedCount).toBe(0);
        expect(result.current.isTicked(0)).toBe(false);
    });
});

describe('useCookingSession — a command is valid only for the step it was drawn on', () => {
    it('lands on the last step, not Done, when Next is tapped twice before the screen redraws', () => {
        const { result } = mount();
        act(() => result.current.next());
        expect(result.current.place.position).toBe(2);

        const { next } = result.current;
        act(() => {
            next();
            next();
        });

        expect(result.current.place.position).toBe(3);
        expect(result.current.status).toBe('cooking');
    });

    it('goes back one step, not two, when Back is tapped twice before the screen redraws', () => {
        const { result } = mount();
        act(() => result.current.next());
        act(() => result.current.next());

        const { back } = result.current;
        act(() => {
            back();
            back();
        });

        expect(result.current.place.position).toBe(2);
    });

    it('ignores a tick queued before Next, and does not throw for a line the new step has not got', () => {
        const { result } = mount();
        const { next, tick, untick } = result.current;

        act(() => {
            next();
            tick(1);
            tick(0);
            untick(0);
        });

        expect(result.current.place.position).toBe(2);
        expect(result.current.tickedCount).toBe(0);
        act(() => result.current.back());
        expect(result.current.tickedCount).toBe(0);
    });
});

describe('useCookingSession — ticking lines', () => {
    it('moves the focus to the next unticked line, and shows next coming when every line is ticked', () => {
        const { result } = mount();

        act(() => result.current.tick(0));
        expect(result.current.focusLine).toBe(1);
        expect(result.current.tickedCount).toBe(1);
        expect(result.current.isTicked(0)).toBe(true);
        expect(result.current.everyLineTicked).toBe(false);

        act(() => result.current.tick(1));
        expect(result.current.focusLine).toBeNull();
        expect(result.current.everyLineTicked).toBe(true);
    });

    it('makes an unticked line above the focus the focus again', () => {
        const { result } = mount();

        act(() => result.current.tick(0));
        act(() => result.current.untick(0));

        expect(result.current.focusLine).toBe(0);
        expect(result.current.isTicked(0)).toBe(false);
    });

    it('keeps a step’s ticks when the cook goes to another step and back', () => {
        const { result } = mount();

        act(() => result.current.tick(0));
        act(() => result.current.next());
        expect(result.current.isTicked(0)).toBe(false);

        act(() => result.current.back());
        expect(result.current.isTicked(0)).toBe(true);
        expect(result.current.focusLine).toBe(1);
    });

    it('does not require a tick to move on', () => {
        const { result } = mount();

        act(() => result.current.next());

        expect(result.current.place.position).toBe(2);
    });
});

describe('useCookingSession — the recipe is read once (R-15)', () => {
    it('ignores a later change to the recipe’s steps', () => {
        const { result, rerender } = mount();

        rerender({ steps: [{ stepNumber: 1, instruction: 'A different first step. With two lines.' }] });

        expect(result.current.place.total).toBe(3);
        expect(result.current.step.lines).toEqual(['Heat the oil.', 'Add the onion.']);
    });

    it('refuses a recipe with nothing to cook, because the screen never mounts it then', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => mount([{ stepNumber: 1, instruction: ' ' }])).toThrow(InvalidTotalStepsError);
        spy.mockRestore();
    });
});

describe('useCookingSession — the screen stays on while cooking and only then', () => {
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
