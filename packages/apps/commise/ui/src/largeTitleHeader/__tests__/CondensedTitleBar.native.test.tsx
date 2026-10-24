/**
 * The native CondensedTitleBar (buildSpec §3.3, D12; `docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4, §5): the pinned
 * bar. A given `back` or `menu` is ALWAYS rendered, named and pressable, in every combination of the two display facts
 * (`surfaceShown`, `titleShown`); only the material and the title fade. The title is repeated for sight only. The bar's
 * empty band passes taps through (Home's avatar sits under it), and the material is hidden through `ChromeSurface`'s own
 * `visible` and the title's opacity, never an opacity on the bar (which would stop a GlassView rendering).
 *
 * ⚠️ This file REWRITES the old "takes no touches and is hidden from assistive tech while hidden" test. That contract is
 * the defect the pinned bar removes: a hidden bar left the page with no reachable Back in the dead band above the title,
 * and the header's own Back, still in the tree off screen, became a second element with the same name.
 *
 * `fireEvent.click` fires through `pointer-events: none` and `aria-hidden`, so presence is proved with `hidden: true`
 * queries and the computed `pointerEvents`, never with a click alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android', width: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
        useWindowDimensions: () => ({ width: platform.width, height: 800, scale: 1, fontScale: 1 }),
    };
});

import { CondensedTitleBar } from '../CondensedTitleBar.native.js';
import { PINNED_BAR_HEIGHT } from '../barGeometry.js';

afterEach(() => {
    cleanup();
    platform.os = 'ios';
    platform.width = 390;
});

const back = (onPress = vi.fn()) => ({ label: 'Back to Collections', parent: 'Collections', onPress });
const FLAGS = [
    { surfaceShown: false, titleShown: false },
    { surfaceShown: true, titleShown: false },
    { surfaceShown: false, titleShown: true },
    { surfaceShown: true, titleShown: true },
] as const;

describe('CondensedTitleBar (native)', () => {
    it.each(FLAGS)('keeps Back rendered, named and pressable with %o', (flags) => {
        const onPress = vi.fn();
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" {...flags} back={back(onPress)} />);
        const bar = container.firstElementChild as HTMLElement;

        // Present in the accessibility tree: no hidden ancestor, found WITHOUT the `hidden` escape hatch.
        const control = screen.getByRole('button', { name: 'Back to Collections' });

        expect(bar.getAttribute('aria-hidden')).toBeNull();
        expect(getComputedStyle(control).pointerEvents).not.toBe('none');
        fireEvent.click(control);
        expect(onPress).toHaveBeenCalledOnce();
    });

    it.each(FLAGS)('renders exactly one element named Back, hidden or not, with %o', (flags) => {
        render(<CondensedTitleBar title="Weeknight dinners" {...flags} back={back()} />);

        expect(screen.getAllByRole('button', { name: 'Back to Collections', hidden: true })).toHaveLength(1);
    });

    it.each(FLAGS)('keeps the menu rendered with %o', (flags) => {
        render(<CondensedTitleBar title="Dinners" {...flags} menu={<button type="button">More actions</button>} />);

        expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    });

    // react-native-web renders `pointerEvents="box-none"` as `pointer-events: none` on the box and `auto` on its
    // children that are controls, which is the pass-through Home's avatar needs. A bar that were `none` all through
    // would compute `none` on the Back control too.
    it('lets an empty band pass taps through: the band and the title take none, the controls take their own', () => {
        const { container } = render(
            <CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown back={back()} />,
        );
        const bar = container.firstElementChild as HTMLElement;

        expect(getComputedStyle(bar).pointerEvents).toBe('none');
        expect(getComputedStyle(screen.getByText('Weeknight dinners')).pointerEvents).toBe('none');
        expect(getComputedStyle(screen.getByRole('button', { name: 'Back to Collections' })).pointerEvents).toBe(
            'auto',
        );
    });

    // ⛔ ON ANDROID A `Text` TAKES A TAP WHATEVER ITS OWN `pointerEvents` SAYS. The title stretches across the bar, and
    // the bar covers Home's avatar, so a title Text alone ate the avatar's tap on Android (local Android run,
    // 2026-10-23: Home's Profile tap did nothing, while iOS passed). A View honours `pointerEvents` on both platforms,
    // so the title sits inside one that takes none.
    it('wraps the title in a View that takes no touches, because Android ignores pointerEvents on a Text', () => {
        const { container } = render(
            <CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown back={back()} />,
        );
        const bar = container.firstElementChild as HTMLElement;
        const wrapper = screen.getByText('Weeknight dinners').parentElement as HTMLElement;

        // Its own View, not the bar: the bar is `box-none`, which a Text inside it does not inherit on Android.
        expect(wrapper).not.toBe(bar);
        expect(bar.contains(wrapper)).toBe(true);
        expect(getComputedStyle(wrapper).pointerEvents).toBe('none');
    });

    it('repeats the title for sight only: hidden from assistive tech, and shown by titleShown alone', () => {
        const { rerender } = render(<CondensedTitleBar title="Weeknight dinners" surfaceShown={false} titleShown />);
        const title = screen.getByText('Weeknight dinners');

        expect(title.getAttribute('aria-hidden')).toBe('true');
        expect(getComputedStyle(title).opacity).toBe('1');

        rerender(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown={false} />);

        expect(getComputedStyle(screen.getByText('Weeknight dinners')).opacity).toBe('0');
    });

    it('draws no title at all while the page does not know it yet (loading)', () => {
        const { container } = render(<CondensedTitleBar surfaceShown={false} titleShown={false} back={back()} />);

        expect(container.textContent).toBe('');
    });

    it('never puts an opacity on the bar itself: it would stop a GlassView rendering', () => {
        const { container } = render(<CondensedTitleBar title="Dinners" surfaceShown={false} titleShown={false} />);
        const bar = container.firstElementChild as HTMLElement;

        expect(getComputedStyle(bar).opacity === '' || getComputedStyle(bar).opacity === '1').toBe(true);
    });
});

describe('CondensedTitleBar (native) — its place in the safe-area frame', () => {
    it('is the pinned height tall and adds no status-bar inset of its own: the screen frame already clears it', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" surfaceShown titleShown />);
        const bar = container.firstElementChild as HTMLElement;

        expect(PINNED_BAR_HEIGHT).toBe(56);
        expect(getComputedStyle(bar).height).toBe('56px');
        expect(getComputedStyle(bar).paddingTop === '' || getComputedStyle(bar).paddingTop === '0px').toBe(true);
    });
});

describe('CondensedTitleBar (native) — the Back control', () => {
    it('is a 44 pt frame on iOS', () => {
        platform.os = 'ios';
        render(<CondensedTitleBar surfaceShown titleShown back={back()} />);
        const control = getComputedStyle(screen.getByRole('button', { name: 'Back to Collections' }));

        expect(control.width).toBe('44px');
        expect(control.height).toBe('44px');
    });

    it('is a 48 dp frame on Android: Material’s floor, not Apple’s', () => {
        platform.os = 'android';
        render(<CondensedTitleBar surfaceShown titleShown back={back()} />);
        const control = getComputedStyle(screen.getByRole('button', { name: 'Back to Collections' }));

        expect(control.width).toBe('48px');
        expect(control.height).toBe('48px');
    });

    it('is the chevron alone on a phone, and the chevron plus the parent’s name from a tablet', () => {
        platform.width = 390;
        const phone = render(<CondensedTitleBar surfaceShown titleShown back={back()} />);

        expect(phone.queryByText('Collections')).toBeNull();
        phone.unmount();

        platform.width = 834;
        render(<CondensedTitleBar surfaceShown titleShown back={back()} />);

        // The visible parent name is for sight; the accessible name stays the full "Back to Collections".
        expect(screen.getByText('Collections')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Back to Collections', hidden: true })).toHaveLength(1);
    });
});

describe('CondensedTitleBar (native) — where the chevron sits', () => {
    // react-native-web writes a dynamic `paddingStart` inline as the physical `padding-left` in LTR.
    const startOf = (node: Element): string => getComputedStyle(node).paddingLeft;

    it.each([
        ['ios', '6px', '10px'],
        ['android', '4px', '12px'],
    ] as const)('on %s a tablet’s chevron gets the same leading room as a phone’s, not x≈8', (os, bar, lead) => {
        platform.os = os;
        platform.width = 834;
        const { container } = render(<CondensedTitleBar surfaceShown titleShown back={back()} />);
        const control = screen.getByRole('button', { name: 'Back to Collections' });

        // bar start padding + the control's leading room = the glyph's left edge at the 16 pt gutter.
        expect(startOf(container.firstElementChild as Element)).toBe(bar);
        expect(startOf(control)).toBe(lead);
    });

    it('on a phone the glyph is centred in the frame, so the control needs no leading room', () => {
        platform.os = 'ios';
        platform.width = 390;
        const { container } = render(<CondensedTitleBar surfaceShown titleShown back={back()} />);

        expect(startOf(container.firstElementChild as Element)).toBe('6px');
        expect(startOf(screen.getByRole('button', { name: 'Back to Collections' }))).not.toBe('10px');
    });
});
