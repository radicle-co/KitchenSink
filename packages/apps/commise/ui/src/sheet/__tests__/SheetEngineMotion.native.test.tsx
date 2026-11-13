/**
 * The sheet engine across a change of the reduce-motion answer. Tamagui runs a component's animation hooks only while it
 * has a `transition` prop, so an overlay that gains or loses one while mounted changes its hook count and React throws.
 * The answer arrives after the first render (React Native reads it asynchronously), and the cook can change it in the OS
 * while a sheet is open, so both directions happen.
 *
 * Nothing is mocked here: Tamagui's `Sheet` finds its overlay by type, so a recording wrapper (as in
 * `SheetEngine.native.test.tsx`) hides the overlay from the engine and hides this failure with it. The engine is rendered
 * alone and open, because the sheet opens it only once its window has shown, which jsdom never reports.
 */
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../../testing/tamaguiTesting.native.js';
import { SheetEngine } from '../SheetEngine.native.js';

const engineWith = (reduceMotion: boolean | undefined): ReactElement => (
    <SheetEngine open onTransition={vi.fn()} reduceMotion={reduceMotion}>
        <Text>Dietary</Text>
    </SheetEngine>
);

describe('SheetEngine across a change of the reduce-motion answer', () => {
    it.each([
        ['arrives as off after the sheet opened', undefined, false],
        ['turns off while the sheet is open', true, false],
        ['turns on while the sheet is open', false, true],
    ] as const)('keeps the open sheet rendering when the answer %s', (_change, before, after) => {
        const { rerender } = render(engineWith(before));

        rerender(engineWith(after));

        expect(screen.getByText('Dietary')).toBeTruthy();
    });
});
