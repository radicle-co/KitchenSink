// @vitest-environment jsdom
/**
 * The web `useRenderedHeight`: the one reader of an element's laid-out height, shared by the pushed-page bar and the
 * snackbar region. jsdom lays nothing out, so each node states its height through `data-height` and the
 * `ResizeObserver` is a stub the test fires.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState, type FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRenderedHeight } from '../useRenderedHeight.js';

const observers = new Set<{ readonly report: () => void; disconnected: boolean }>();

class ResizeObserverStub {
    private readonly entry: { readonly report: () => void; disconnected: boolean };

    public constructor(report: () => void) {
        this.entry = { report, disconnected: false };
        observers.add(this.entry);
    }

    public observe(): void {}

    public unobserve(): void {}

    public disconnect(): void {
        this.entry.disconnected = true;
        observers.delete(this.entry);
    }
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { height: Number(this.dataset['height'] ?? 0) } as DOMRect;
    });
});

afterEach(() => {
    cleanup();
    observers.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const Probe: FC<{ readonly initial: number }> = ({ initial }) => {
    const [node, setNode] = useState<HTMLElement | null>(null);
    const height = useRenderedHeight(node, initial);

    return (
        <div ref={setNode} data-height="40" data-testid="box">
            {height}
        </div>
    );
};

describe('useRenderedHeight', () => {
    it('answers the initial height before the element is read, then the laid-out height', () => {
        render(<Probe initial={99} />);

        expect(screen.getByTestId('box').textContent).toBe('40');
    });

    it('reads again when the observer reports a new box', () => {
        render(<Probe initial={0} />);
        screen.getByTestId('box').dataset['height'] = '72';
        act(() => {
            observers.forEach((o) => o.report());
        });

        expect(screen.getByTestId('box').textContent).toBe('72');
    });

    it('reads again when the window resizes', () => {
        render(<Probe initial={0} />);
        screen.getByTestId('box').dataset['height'] = '55';
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.getByTestId('box').textContent).toBe('55');
    });

    it('stops observing and listening when it unmounts', () => {
        const { unmount } = render(<Probe initial={0} />);
        expect(observers.size).toBe(1);
        const remove = vi.spyOn(window, 'removeEventListener');
        unmount();

        expect(observers.size).toBe(0);
        expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});
