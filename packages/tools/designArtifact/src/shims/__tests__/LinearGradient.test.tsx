// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LinearGradient } from '../linearGradient.js';

describe('LinearGradient (expo-linear-gradient Adapter)', () => {
    it('paints a view with the CSS gradient from its props and renders its children', () => {
        const { container } = render(
            <LinearGradient colors={['red', 'blue']} start={[0, 0.5]} end={[1, 0.5]} testID="g">
                <span>inside</span>
            </LinearGradient>,
        );

        expect(screen.getByText('inside')).toBeTruthy();
        const painted = container.firstElementChild as HTMLElement;
        expect(painted.style.backgroundImage).toBe('linear-gradient(90deg, red 0%, blue 100%)');
    });

    it('repaints against the real size once the view is laid out, and forwards the caller’s onLayout', async () => {
        let observed: ((entries: unknown[]) => void) | undefined;
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: (entries: unknown[]) => void) {
                    observed = callback;
                }
                observe(): void {}
                disconnect(): void {}
                unobserve(): void {}
            },
        );
        const onLayout = vi.fn();
        const { container } = render(
            <LinearGradient
                colors={['red', 'blue']}
                start={{ x: 0.1464, y: 0.1464 }}
                end={{ x: 0.8536, y: 0.8536 }}
                onLayout={onLayout}
            />,
        );
        const view = container.firstElementChild as HTMLElement;

        // react-native-web measures the node itself when the observer fires; jsdom has no layout, so give it one.
        Object.defineProperty(view, 'offsetWidth', { value: 390 });
        Object.defineProperty(view, 'offsetHeight', { value: 200 });
        act(() => {
            observed?.([{ target: view }]);
        });

        await waitFor(() => {
            expect(view.style.backgroundImage).toMatch(
                /^linear-gradient\(117\.1\d*deg, red 14\.\d+%, blue 85\.\d+%\)$/u,
            );
        });
        expect(onLayout).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('refuses a colour it cannot paint instead of drawing black', () => {
        expect(() => render(<LinearGradient colors={['#111', 7 as never]} />)).toThrow(/colour/i);
    });
});
