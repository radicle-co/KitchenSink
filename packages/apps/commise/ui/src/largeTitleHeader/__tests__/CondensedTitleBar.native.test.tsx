/**
 * The native CondensedTitleBar (buildSpec §3.3, D12): the title repeated for sight only, back one tap away, and — while
 * hidden — no touches, hidden from assistive tech, and hidden through the material and the title, never an opacity on
 * the bar (which would stop a GlassView rendering).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CondensedTitleBar } from '../CondensedTitleBar.native.js';

afterEach(cleanup);

describe('CondensedTitleBar (native)', () => {
    it('keeps back one tap away while shown', () => {
        const onPress = vi.fn();
        render(
            <CondensedTitleBar
                title="Weeknight dinners"
                visible
                back={{ label: 'Back to Collections', parent: 'Collections', onPress }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Back to Collections' }));

        expect(onPress).toHaveBeenCalledOnce();
    });

    it('takes no touches and is hidden from assistive tech while hidden, with no opacity on the bar itself', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" visible={false} />);
        const bar = container.firstElementChild;

        if (!(bar instanceof HTMLElement)) {
            throw new Error('no bar');
        }

        expect(bar.getAttribute('aria-hidden')).toBe('true');
        expect(getComputedStyle(bar).pointerEvents).toBe('none');
        expect(getComputedStyle(bar).opacity === '' || getComputedStyle(bar).opacity === '1').toBe(true);
    });
});

describe('CondensedTitleBar (native) — its place in the safe-area frame', () => {
    it('is 56 pt tall and adds no status-bar inset of its own: the screen frame already clears it', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" visible />);
        const bar = container.firstElementChild as HTMLElement;

        expect(getComputedStyle(bar).height).toBe('56px');
        expect(getComputedStyle(bar).paddingTop === '' || getComputedStyle(bar).paddingTop === '0px').toBe(true);
    });
});
