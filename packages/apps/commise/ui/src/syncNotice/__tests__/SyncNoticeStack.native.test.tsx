/**
 * SyncNoticeStack (native): the in-flow column both notices sit in, ABOVE the navigator.
 *
 * ⛔ IT OWNS THE TOP INSET WHILE ANYTHING SHOWS (`offlineNotice.md` §7). The notice is the topmost element, and a card
 * drawn under the status bar drops out of the accessibility hierarchy. While nothing shows it takes no space at all,
 * so the screens below keep the inset they pad themselves.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncNoticeStack } from '../SyncNoticeStack.native.js';

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

afterEach(cleanup);

function column(): HTMLElement {
    const parent = screen.getByText('card').parentElement;

    if (parent === null) {
        throw new Error('the stack rendered no column');
    }

    return parent;
}

describe('SyncNoticeStack (native)', () => {
    it('⛔ pads the top by the device inset while a notice shows', () => {
        render(
            <SyncNoticeStack active>
                <p>card</p>
            </SyncNoticeStack>,
        );

        expect(getComputedStyle(column()).paddingTop).toBe('47px');
    });

    it('⛔ takes no space while nothing shows', () => {
        render(
            <SyncNoticeStack active={false}>
                <p>card</p>
            </SyncNoticeStack>,
        );

        expect(getComputedStyle(column()).paddingTop).toBe('0px');
    });
});
