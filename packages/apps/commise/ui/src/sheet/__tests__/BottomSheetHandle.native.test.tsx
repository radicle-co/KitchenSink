/**
 * The native bottom sheet's grab handle (parity item 7, `componentFixes.md` §3, owner-approved) and its corner radius.
 *
 * The sheet could be dismissed by a downward swipe on its title row, but drew nothing to say so. The handle is a
 * 36 by 5 pt pill, `lineDivider`, 8 pt from the top and 4 pt above the title row, INSIDE the swipe zone (a drag that
 * starts on it dismisses with the same thresholds) and decorative: the labelled Close button stays the accessible way
 * to dismiss (WCAG 2.5.7). The top corners are `radius.xl` (24), the dialog and sheet step; `lg` (18) is a notice's.
 *
 * The swipe hook is stood in for by one that hands the zone a DOM touch handler, so "inside the swipe zone" is
 * observable: a touch that starts on the handle must reach the same element the title row's touches reach.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

const swipe = vi.hoisted(() => ({ touched: vi.fn() }));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));
vi.mock('../useSwipeToDismiss.native.js', async () => {
    const { Animated } = await import('react-native');

    return {
        useSwipeToDismiss: () => ({
            panHandlers: { onTouchStart: swipe.touched },
            translateY: new Animated.Value(0),
        }),
    };
});

import { role } from '../../tokens/colors.js';
import { radius } from '../../tokens/scale.js';
import { BottomSheetPanel } from '../BottomSheetPanel.native.js';

afterEach(() => {
    cleanup();
    swipe.touched.mockClear();
});

function renderPanel(): void {
    render(
        <BottomSheetPanel
            title="Add to plan"
            closeLabel="Close"
            size="content"
            focusSignal={0}
            reduceMotion={false}
            onClose={vi.fn()}
        >
            <Text>Body</Text>
        </BottomSheetPanel>,
    );
}

/**
 * The handle: it has no role or text and the production markup carries no test hook, so it is found by what it IS, the
 * decorative 36 by 5 pt pill inside the dialog.
 */
const handle = (): HTMLElement => {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] [aria-hidden="true"]')).find(
        (element) => {
            const style = getComputedStyle(element);

            return style.width === '36px' && style.height === '5px';
        },
    );

    if (found === undefined) {
        throw new Error('The sheet draws no grab handle.');
    }

    return found;
};

/** A one-finger touch, shaped as react-native-web's responder system reads it. */
const finger = { identifier: 0, clientX: 10, clientY: 10, pageX: 10, pageY: 10, force: 1 };
const touch = { touches: [finger], changedTouches: [finger], targetTouches: [finger] };

describe('BottomSheetPanel (native) — the grab handle', () => {
    it('is a 36 by 5 pt lineDivider pill', () => {
        renderPanel();
        const style = getComputedStyle(handle());

        expect(style.width).toBe('36px');
        expect(style.height).toBe('5px');
        expect(style.backgroundColor).toBe(
            `rgb(${[1, 3, 5].map((at) => Number.parseInt(role.lineDivider.slice(at, at + 2), 16)).join(', ')})`,
        );
        // radius.full draws the same pill a 3 pt radius draws on a 5 pt bar, and stays on the radius scale.
        expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThanOrEqual(2.5);
    });

    it('sits 8 pt from the top with 4 pt below it, centred', () => {
        renderPanel();
        const style = getComputedStyle(handle());

        expect(style.marginTop).toBe('8px');
        expect(style.marginBottom).toBe('4px');
        expect(style.alignSelf).toBe('center');
    });

    it('is decorative: hidden from the screen reader, no role, and not focusable', () => {
        renderPanel();
        const hidden = handle().closest('[aria-hidden="true"]');

        expect(hidden).not.toBeNull();
        expect(handle().getAttribute('role')).toBeNull();
        expect(handle().getAttribute('tabindex')).toBeNull();
    });

    it('is inside the swipe zone, so a drag that starts on it reaches the same handlers as the title row', () => {
        renderPanel();

        fireEvent.touchStart(handle(), touch);
        expect(swipe.touched).toHaveBeenCalledTimes(1);

        fireEvent.touchStart(screen.getByRole('heading', { name: 'Add to plan' }), touch);
        expect(swipe.touched).toHaveBeenCalledTimes(2);
    });

    it('keeps the labelled Close button as the way to dismiss', () => {
        renderPanel();

        expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    });
});

describe('BottomSheetPanel (native) — the corner radius', () => {
    it('rounds its top corners at radius.xl (24), not lg', () => {
        renderPanel();
        const sheet = screen.getByRole('dialog');
        const style = getComputedStyle(sheet);

        expect(style.borderTopLeftRadius).toBe(`${String(radius.xl)}px`);
        expect(style.borderTopRightRadius).toBe(`${String(radius.xl)}px`);
        expect(radius.xl).toBe(24);
    });
});
