// @vitest-environment jsdom
/**
 * The design system's ONE focus-request mechanism (`useFocusRequest`): a host raises a level (`focusRequested`) until the
 * control has taken focus and acknowledged it. Twelve copies of this effect lived in the primitives and the ingredient row
 * (staff-code-quality, 2026-10-09); these tests pin the contract every copy implemented.
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFocusRequest } from '../useFocusRequest.js';

afterEach(cleanup);

type Props = { readonly requested: boolean; readonly take: () => void; readonly onHandled?: () => void };

const render = (initial: Props) =>
    renderHook((props: Props) => useFocusRequest(props.requested, props.take, props.onHandled), {
        initialProps: initial,
    });

describe('useFocusRequest', () => {
    it('takes focus and acknowledges when the request is raised, in that order', () => {
        const calls: string[] = [];
        render({ requested: true, take: () => calls.push('take'), onHandled: () => calls.push('handled') });

        expect(calls).toEqual(['take', 'handled']);
    });

    it('does nothing while no request is raised', () => {
        const take = vi.fn();
        const onHandled = vi.fn();
        render({ requested: false, take, onHandled });

        expect(take).not.toHaveBeenCalled();
        expect(onHandled).not.toHaveBeenCalled();
    });

    it('does not take a request again for a new callback or a re-render while it stays raised', () => {
        const take = vi.fn();
        const { rerender } = render({ requested: true, take });

        rerender({ requested: true, take: vi.fn() });
        rerender({ requested: true, take });

        expect(take).toHaveBeenCalledTimes(1);
    });

    it('calls the latest callbacks when a request is raised again', () => {
        const first = vi.fn();
        const second = vi.fn();
        const onHandled = vi.fn();
        const { rerender } = render({ requested: false, take: first });

        rerender({ requested: true, take: second, onHandled });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(onHandled).toHaveBeenCalledTimes(1);

        rerender({ requested: false, take: second, onHandled });
        rerender({ requested: true, take: second, onHandled });

        expect(second).toHaveBeenCalledTimes(2);
    });
});
