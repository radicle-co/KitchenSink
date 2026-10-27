/**
 * The design-system `ChoiceRow` (native), through react-native-web: the React Native leaf of `../ChoiceRow.tsx`, on the
 * same props. A `button`-role `Pressable` whose press is the choice; a check when chosen; a spinner and a busy state
 * while its send is in flight; disabled (which keeps screen-reader focus on device) and dimmed like the Combobox's busy
 * option while busy or refused; the native touch floor; and a host's focus request moves the screen-reader cursor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { ComponentProps } from 'react';
import { AccessibilityInfo, Text } from 'react-native';

import { touchFloor } from '../../layout/touchFloor.native.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';
import { ChoiceRow } from '../ChoiceRow.native.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus request reads its calls.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

type Props = ComponentProps<typeof ChoiceRow>;

const row = (props: Partial<Props> = {}) => (
    <ChoiceRow
        accessibilityLabel="Whole milk, Default"
        chosen={false}
        busy={false}
        refused={false}
        onPress={props.onPress ?? vi.fn()}
        {...props}
    >
        <Text>Whole milk</Text>
    </ChoiceRow>
);

const theRow = () => screen.getByRole('button', { name: 'Whole milk, Default' });

describe('ChoiceRow (native)', () => {
    it('is a button named by its accessible name, whose press is the choice', () => {
        const onPress = vi.fn();
        render(row({ onPress }));

        fireEvent.click(theRow());

        expect(theRow().textContent).toBe('Whole milk');
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('draws a check when chosen, and nothing after the label at rest', () => {
        const { rerender } = render(row());

        expect(theRow().querySelector('[data-commise-stub="icon"]')).toBeNull();

        rerender(row({ chosen: true }));

        expect(theRow().querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe('check');
    });

    it('⛔ busy: a spinner and a busy state, the press refused, and dimmed', () => {
        const onPress = vi.fn();
        render(row({ busy: true, onPress }));

        fireEvent.click(theRow());

        expect(theRow().getAttribute('aria-busy')).toBe('true');
        expect(theRow().getAttribute('aria-disabled')).toBe('true');
        expect(theRow().querySelector('[role="progressbar"]')).not.toBeNull();
        expect(getComputedStyle(theRow()).opacity).toBe('0.6');
        expect(onPress).not.toHaveBeenCalled();
    });

    it('⛔ refused: the press refused and dimmed, with no busy claim and no spinner', () => {
        const onPress = vi.fn();
        render(row({ refused: true, onPress }));

        fireEvent.click(theRow());

        expect(theRow().getAttribute('aria-disabled')).toBe('true');
        expect(theRow().getAttribute('aria-busy')).not.toBe('true');
        expect(theRow().querySelector('[role="progressbar"]')).toBeNull();
        expect(getComputedStyle(theRow()).opacity).toBe('0.6');
        expect(onPress).not.toHaveBeenCalled();
    });

    it('is not dimmed at rest', () => {
        render(row());

        expect(getComputedStyle(theRow()).opacity).not.toBe('0.6');
    });

    it.each(['ios', 'android'] as const)('keeps the touch floor on %s', (os) => {
        withPlatformOs(os, () => {
            render(row());

            expect(getComputedStyle(theRow()).minHeight).toBe(`${String(touchFloor())}px`);
        });
    });

    it('moves the screen-reader cursor to the row on a focus request, once, and acknowledges', () => {
        const handled = vi.fn();
        const { rerender } = render(row({ focusRequested: false, onFocusRequestHandled: handled }));

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(row({ focusRequested: true, onFocusRequestHandled: handled }));
        rerender(row({ focusRequested: true, onFocusRequestHandled: handled }));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(theRow(), 'focus');
        expect(handled).toHaveBeenCalledTimes(1);
    });
});
