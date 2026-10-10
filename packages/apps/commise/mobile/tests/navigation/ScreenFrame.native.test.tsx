/**
 * The routed screens' safe-area frame: the top inset clears the status bar, the side insets clear a cutout or a
 * three-button bar in landscape (staff-ux-engineer landscape EVALUATE, finding 2), and the bottom inset is padded only
 * where no tab bar owns the foot — a focused task. Moved here from `HomeScreen` and `RecipesScreen`, which padded
 * themselves before the navigator framed them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Text } from 'react-native';

vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSafeAreaInsets: () => ({ top: 24, right: 48, bottom: 34, left: 59 }),
}));

const { ScreenFrame } = await import('../../src/navigation/ScreenFrame.js');

afterEach(cleanup);

const frameOf = (): HTMLElement => {
    const frame = screen.getByText('screen').parentElement;

    if (frame === null) {
        throw new Error('no frame');
    }

    return frame;
};

describe('ScreenFrame', () => {
    it('pads a tab screen by the top and both side insets, leaving the bottom to the tab bar', () => {
        render(
            <ScreenFrame ownsBottom={false}>
                <Text>screen</Text>
            </ScreenFrame>,
        );

        expect(frameOf().style.paddingTop).toBe('24px');
        expect(frameOf().style.paddingLeft).toBe('59px');
        expect(frameOf().style.paddingRight).toBe('48px');
        expect(frameOf().style.paddingBottom).toBe('0px');
    });

    it('pads a focused task’s foot by the bottom inset too', () => {
        render(
            <ScreenFrame ownsBottom>
                <Text>screen</Text>
            </ScreenFrame>,
        );

        expect(frameOf().style.paddingBottom).toBe('34px');
    });
});
