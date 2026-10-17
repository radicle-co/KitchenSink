// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
    initialWindowMetrics,
    SafeAreaInsetsContext,
    SafeAreaProvider,
    SafeAreaView,
    useSafeAreaFrame,
    useSafeAreaInsets,
} from '../safeAreaContext.js';

afterEach(() => {
    delete window.__commiseInsets;
});

function Insets(): ReactElement {
    return <output>{JSON.stringify(useSafeAreaInsets())}</output>;
}

function Frame(): ReactElement {
    return <output>{JSON.stringify(useSafeAreaFrame())}</output>;
}

const padding = (element: HTMLElement): string[] => [
    element.style.paddingTop,
    element.style.paddingRight,
    element.style.paddingBottom,
    element.style.paddingLeft,
];

describe('safe-area adapter', () => {
    it('answers iPhone insets with no provider', () => {
        render(<Insets />);

        expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
            top: 47,
            right: 0,
            bottom: 34,
            left: 0,
        });
    });

    it('takes an insets override from the artifact globals', () => {
        window.__commiseInsets = { top: 20, right: 1, bottom: 2, left: 3 };
        render(<Insets />);

        expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
            top: 20,
            right: 1,
            bottom: 2,
            left: 3,
        });
    });

    it('prefers a provider initialMetrics over the default', () => {
        render(
            <SafeAreaProvider
                initialMetrics={{
                    insets: { top: 5, right: 6, bottom: 7, left: 8 },
                    frame: { x: 0, y: 0, width: 1, height: 1 },
                }}
            >
                <Insets />
            </SafeAreaProvider>,
        );

        expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
            top: 5,
            right: 6,
            bottom: 7,
            left: 8,
        });
    });

    it('lets a context value win over everything', () => {
        render(
            <SafeAreaInsetsContext.Provider value={{ top: 1, right: 1, bottom: 1, left: 1 }}>
                <Insets />
            </SafeAreaInsetsContext.Provider>,
        );

        expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
            top: 1,
            right: 1,
            bottom: 1,
            left: 1,
        });
    });

    it('reports the window as the frame', () => {
        render(<Frame />);

        expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
        });
    });

    it('exports a 390 x 844 initial window', () => {
        expect(initialWindowMetrics.frame).toEqual({ x: 0, y: 0, width: 390, height: 844 });
        expect(initialWindowMetrics.insets).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
    });

    describe('SafeAreaView edges', () => {
        const edgeCases: ReadonlyArray<{
            name: string;
            edges?: ReadonlyArray<'top' | 'right' | 'bottom' | 'left'>;
            expected: string[];
        }> = [
            { name: 'all four by default', expected: ['47px', '0px', '34px', '0px'] },
            { name: 'top only', edges: ['top'], expected: ['47px', '0px', '0px', '0px'] },
            { name: 'bottom only', edges: ['bottom'], expected: ['0px', '0px', '34px', '0px'] },
            { name: 'top and bottom', edges: ['top', 'bottom'], expected: ['47px', '0px', '34px', '0px'] },
            { name: 'no edges', edges: [], expected: ['0px', '0px', '0px', '0px'] },
        ];

        it.each(edgeCases)('applies $name', ({ edges, expected }) => {
            render(<SafeAreaView edges={edges} testID="sav" />);

            expect(padding(screen.getByTestId('sav'))).toEqual(expected);
        });

        it('adds an inset to the view own padding on an additive edge', () => {
            render(<SafeAreaView edges={{ top: 'additive' }} style={{ paddingTop: 10 }} testID="sav" />);

            expect(padding(screen.getByTestId('sav'))[0]).toBe('57px');
        });

        it('takes the larger of inset and own padding on a maximum edge', () => {
            render(
                <SafeAreaView
                    edges={{ top: 'maximum', bottom: 'maximum' }}
                    style={{ paddingTop: 10, paddingBottom: 90 }}
                    testID="sav"
                />,
            );

            const [top, , bottom] = padding(screen.getByTestId('sav'));
            expect([top, bottom]).toEqual(['47px', '90px']);
        });

        it('leaves an off edge to the view own padding', () => {
            render(<SafeAreaView edges={{ top: 'off' }} style={{ paddingTop: 10 }} testID="sav" />);

            expect(padding(screen.getByTestId('sav'))[0]).toBe('10px');
        });
    });
});
