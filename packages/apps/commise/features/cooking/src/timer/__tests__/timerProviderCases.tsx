import { KEPT_KEY_PREFIX, type KeptSessionStore } from '@commise/features-recipes/session';
import { focusManager } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { expect, it, vi } from 'vitest';

import { makeKeptStore } from '../../__fixtures__/makeKeptStore.js';
import { TimerProvider } from '../TimerProvider.js';
import { useCookingTimers } from '../useCookingTimers.js';

const STEP = { recipeId: 'roast', stepIndex: 2, stepDigest: 's1:0000000d', label: undefined, origin: 'added' } as const;
const MINUTE = 60_000;

/** What the probe last read: the hook's value in the newest render. */
interface Mounted {
    readonly timers: () => ReturnType<typeof useCookingTimers>;
    readonly rerender: (subject: string | null | undefined) => void;
    readonly unmount: () => void;
}

/** Mounts a probe of the hook under a provider whose cook the test can change. */
function mount(
    subject: string | null | undefined,
    strict = false,
    kept: KeptSessionStore = makeKeptStore().kept,
): Mounted {
    let read: ReturnType<typeof useCookingTimers> | undefined;

    const Probe = (): null => {
        read = useCookingTimers();

        return null;
    };

    const tree = (cook: string | null | undefined): ReactElement => {
        const inner = (
            <TimerProvider subject={cook} kept={kept}>
                <Probe />
            </TimerProvider>
        );

        return strict ? <StrictMode>{inner}</StrictMode> : inner;
    };

    const view = render(tree(subject));

    return {
        timers: () => {
            if (read === undefined) {
                throw new Error('The probe has not rendered.');
            }

            return read;
        },
        rerender: (cook) => {
            view.rerender(tree(cook));
        },
        unmount: view.unmount,
    };
}

/**
 * The provider's cases, shared by the web and the native test files (the provider is plain React, so both run the same
 * body under their own config). The hook reads the one store the provider makes.
 */
export function timerProviderCases(): void {
    it('gives the hook one store across re-renders', () => {
        const view = mount('A');

        act(() => {
            view.timers().start({ ...STEP, durationMs: 5 * MINUTE });
        });
        view.rerender('A');

        expect(view.timers().order).toHaveLength(1);
        expect(view.timers().alarmQueue).toEqual([]);
    });

    it('writes a started timer through to the kept record it was given', async () => {
        const { kept, data } = makeKeptStore();
        const view = mount('A', false, kept);

        await act(async () => {
            await kept.scope('A');
        });
        await act(async () => {
            view.timers().start({ ...STEP, durationMs: 5 * MINUTE });
            await Promise.resolve();
        });
        await vi.waitFor(() => {
            expect(data.get(`${KEPT_KEY_PREFIX}A`)).toContain('"origin":"added"');
        });
    });

    it('names the held Undo timer after a cancel', () => {
        const view = mount('A');
        let id: string | undefined;

        act(() => {
            id = view.timers().start({ ...STEP, durationMs: 5 * MINUTE });
        });
        act(() => {
            view.timers().command({ kind: 'cancel', id: id ?? '', run: 1 });
        });

        expect(id).toBeDefined();
        expect(view.timers().undoId).toBe(id);
    });

    it('clears the timers when the cook changes, in the same commit', () => {
        const view = mount('A');

        act(() => {
            view.timers().start({ ...STEP, durationMs: 5 * MINUTE });
        });
        expect(view.timers().order).toHaveLength(1);

        view.rerender('B');

        expect(view.timers().order).toEqual([]);
        expect(view.timers().undoId).toBeUndefined();
    });

    it('keeps the timers while Clerk is loading (undefined) and for a first signed-out value', () => {
        const view = mount('A');

        act(() => {
            view.timers().start({ ...STEP, durationMs: 5 * MINUTE });
        });
        view.rerender(undefined);

        expect(view.timers().order).toHaveLength(1);
    });

    it('hears the app come to the front once under StrictMode, and not after it unmounts', () => {
        vi.useFakeTimers({ now: Date.parse('2026-11-20T10:00:00.000Z') });
        focusManager.setFocused(false);

        try {
            const view = mount('A', true);

            act(() => {
                view.timers().start({ ...STEP, durationMs: 5_000 });
            });
            vi.setSystemTime(Date.now() + MINUTE);
            act(() => {
                focusManager.setFocused(true);
            });

            expect(view.timers().alarmQueue).toHaveLength(1);

            view.unmount();

            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
            focusManager.setFocused();
        }
    });

    it('throws a plain error when the hook is read outside the provider', () => {
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useCookingTimers())).toThrow(/TimerProvider/);
        quiet.mockRestore();
    });
}
