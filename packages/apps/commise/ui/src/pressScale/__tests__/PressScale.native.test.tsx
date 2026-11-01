import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { createElement, createRef, type ComponentProps } from 'react';
import { AccessibilityInfo, Text, type Pressable as PressableType, type View } from 'react-native';

import { pressFrameOf, pressScaleOf, render } from '../../testing/tamaguiTesting.native.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PressScale } from '../PressScale.native.js';

/**
 * PressScale (native) — rendered via react-native-web under jsdom, inside the design system's provider. The leaf OWNS
 * the interaction: it renders the `Pressable` and wraps it in `PressScaleFrame`, which carries the width and the press
 * scale. So the tests read the scale and the stretch off the FRAME (the button's parent) and the accessibility contract
 * off the button.
 *
 * react-native-web's `Pressable` fires no `onPressIn`/`onPressOut` from jsdom events (only a click reaches `onPress`),
 * so the `Pressable` mock below records the props it is given and a test calls the press handlers itself. It renders the
 * real `Pressable`, so the DOM and the ref are the real ones.
 */
const recorded = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Pressable: (props: ComponentProps<typeof PressableType>) => {
            recorded.props = props as Record<string, unknown>;

            return createElement(actual.Pressable, props);
        },
    };
});

/** Calls the recorded `Pressable`'s handler, as a held finger would. */
function press(handler: 'onPressIn' | 'onPressOut'): void {
    const call = recorded.props?.[handler];

    if (typeof call !== 'function') {
        throw new Error(`The Pressable was given no ${handler}.`);
    }

    act(() => {
        (call as () => void)();
    });
}

/** The frame PressScale wraps the named button in. */
function frameOf(name: string): HTMLElement {
    return pressFrameOf(screen.getByRole('button', { name }));
}

/** The press scale PressScale draws the named button at. */
function scaleOf(name: string): string {
    return pressScaleOf(screen.getByRole('button', { name }));
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    recorded.props = undefined;
});

describe('PressScale (native)', () => {
    it('exposes an accessible button (its default role) naming its content', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Save changes">
                <Text>Save changes</Text>
            </PressScale>,
        );

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('fires onPress when pressed', () => {
        const onPress = vi.fn();
        render(
            <PressScale onPress={onPress} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Tap me' }));
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('does not fire onPress when disabled', () => {
        const onPress = vi.fn();
        render(
            <PressScale onPress={onPress} disabled accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Tap me' }));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('draws the frame at rest at the neutral scale', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        expect(scaleOf('Tap me')).toBe('1');
    });

    it('shrinks the frame while held, and springs it back on release', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        press('onPressIn');
        expect(scaleOf('Tap me')).toBe('0.98');

        press('onPressOut');
        expect(scaleOf('Tap me')).toBe('1');
    });

    it('holds the frame still while held when the control is disabled', () => {
        render(
            <PressScale onPress={vi.fn()} disabled accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        press('onPressIn');
        expect(scaleOf('Tap me')).toBe('1');
    });

    it('holds the frame still while held when the system asks for reduced motion', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const seen: boolean[] = [];

        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                {({ pressed }) => {
                    seen.push(pressed);

                    return <Text>Tap me</Text>;
                }}
            </PressScale>,
        );
        // Wait until the preference has been read, so the press below meets it.
        await waitFor(() => {
            expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
        });
        await act(async () => {
            await Promise.resolve();
        });

        press('onPressIn');
        expect(seen.at(-1)).toBe(true);
        expect(scaleOf('Tap me')).toBe('1');
    });

    it('fires onPress once per press, through the one responder', () => {
        const onPress = vi.fn();

        render(
            <PressScale onPress={onPress} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        fireEvent.click(frameOf('Tap me'));
        expect(onPress).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Tap me' }));
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('leaves the frame out of the accessibility tree, so a screen reader finds one control', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        const frame = frameOf('Tap me');

        expect(frame.getAttribute('role')).toBeNull();
        expect(frame.getAttribute('aria-label')).toBeNull();
        expect(frame.getAttribute('tabindex')).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });
});

/**
 * A control that paints its own pressed state (the "Screen on" switch) needs the `pressed` flag the `Pressable` owns.
 * The children may be a function of it; at rest it is false. (react-native-web does not toggle `pressed` from synthetic
 * jsdom events, so the true branch is `Pressable`'s own and the paint it selects is unit-tested in the button paint.)
 */
describe('PressScale (native) — pressed state for children', () => {
    it('hands a function child the pressed flag, false at rest', () => {
        const seen: boolean[] = [];
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                {({ pressed }) => {
                    seen.push(pressed);

                    return <Text>Tap me</Text>;
                }}
            </PressScale>,
        );

        expect(screen.getByText('Tap me')).toBeTruthy();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((pressed) => !pressed)).toBe(true);
    });

    it('hands a function child the same pressed flag that drives the scale', () => {
        const seen: boolean[] = [];

        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                {({ pressed }) => {
                    seen.push(pressed);

                    return <Text>Tap me</Text>;
                }}
            </PressScale>,
        );

        press('onPressIn');
        expect(seen.at(-1)).toBe(true);
        expect(scaleOf('Tap me')).toBe('0.98');

        press('onPressOut');
        expect(seen.at(-1)).toBe(false);
    });
    // A control can turn disabled while a finger is down (a save starts). The scale settles at once, because the
    // policy forces 1 while disabled, and the release still clears the flag, so the child is not left painted pressed.
    it('settles when the control turns disabled mid-press, and clears the flag on release', () => {
        const seen: boolean[] = [];
        const child = ({ pressed }: { readonly pressed: boolean }) => {
            seen.push(pressed);

            return <Text>Tap me</Text>;
        };
        const { rerender } = render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                {child}
            </PressScale>,
        );

        press('onPressIn');
        rerender(
            <PressScale onPress={vi.fn()} disabled accessibilityLabel="Tap me">
                {child}
            </PressScale>,
        );
        expect(scaleOf('Tap me')).toBe('1');

        press('onPressOut');
        expect(seen.at(-1)).toBe(false);
        expect(scaleOf('Tap me')).toBe('1');
    });
});

/**
 * A SWITCH that presses like a button (the "Screen on" toggle wears `PressScale` as `Button` does). The pressable must
 * keep the switch role and state it had before adopting `PressScale`: a role that fell back to `button` would drop the
 * on/off state from a screen reader (SC 4.1.2). Both channels are emitted, as `aria-busy` is: react-native-web forwards
 * only the literal `aria-*` props to the DOM.
 */
describe('PressScale (native) — as a switch', () => {
    it.each([true, false])('exposes role switch with aria-checked=%s', (checked) => {
        render(
            <PressScale onPress={vi.fn()} accessibilityRole="switch" checked={checked} accessibilityLabel="Screen on">
                <Text>Screen on</Text>
            </PressScale>,
        );

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.getAttribute('aria-checked')).toBe(String(checked));
        expect(pressScaleOf(toggle)).toBe('1');
    });

    it('states no checked value when it is not a switch', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        expect(screen.getByRole('button', { name: 'Tap me' }).getAttribute('aria-checked')).toBeNull();
    });

    it('fires onPress as a switch', () => {
        const onPress = vi.fn();
        render(
            <PressScale onPress={onPress} accessibilityRole="switch" checked={false} accessibilityLabel="Screen on">
                <Text>Screen on</Text>
            </PressScale>,
        );

        fireEvent.click(screen.getByRole('switch', { name: 'Screen on' }));
        expect(onPress).toHaveBeenCalledOnce();
    });
});

/**
 * `width` (R9, `docs/design/rowEditorOpenDecisions.md`). `auto` adds nothing, so the parent decides for every card and
 * the FAB; `fill` stretches the frame across a parent that would otherwise centre it, and the Pressable fills the frame.
 */
describe('PressScale (native) — width', () => {
    it('leaves the frame to its parent when no width is given', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        expect(getComputedStyle(frameOf('Tap me')).alignSelf).not.toBe('stretch');
    });

    it('leaves the frame to its parent under an explicit auto', () => {
        render(
            <PressScale onPress={vi.fn()} width="auto" accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        expect(getComputedStyle(frameOf('Tap me')).alignSelf).not.toBe('stretch');
    });

    it('stretches the frame across its parent under fill, and keeps the press scale', () => {
        render(
            <PressScale onPress={vi.fn()} width="fill" accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        expect(getComputedStyle(frameOf('Tap me')).alignSelf).toBe('stretch');
        expect(scaleOf('Tap me')).toBe('1');
    });
});

/**
 * The in-flight (`busy`) state must be OBSERVABLE, not merely passed.
 *
 * `accessibilityState.busy` is the device-correct channel, but react-native-web consumes `accessibilityState`
 * for `disabled` ONLY (`modules/AccessibilityUtil/isDisabled.js` is its sole reader) and otherwise forwards
 * just the literal `aria-*` props (`modules/forwardedProps` lists `'aria-busy'`). So a Pressable that sets
 * `accessibilityState={{ busy }}` alone announces correctly on a real device while emitting NOTHING in the DOM
 * — which silently makes the busy state of EVERY native design-system control untestable, and the repo's test
 * mandate requires each UI state to be covered rather than taken on faith.
 *
 * React Native declares `aria-busy` as a first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`),
 * so emitting both is device-correct AND assertable. These tests pin that: `busy` is not merely accepted, it
 * reaches the accessibility tree.
 */
describe('PressScale (native) — busy is announced, not just accepted', () => {
    it('projects busy onto the pressable so assistive tech can read the in-flight state', () => {
        render(
            <PressScale onPress={vi.fn()} busy accessibilityLabel="Saving">
                <Text>Saving</Text>
            </PressScale>,
        );

        expect(screen.getByRole('button', { name: 'Saving' }).getAttribute('aria-busy')).toBe('true');
    });

    it('announces NOT busy when idle (no stale busy attribute)', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Save">
                <Text>Save</Text>
            </PressScale>,
        );

        // Absent or "false" both read as not-busy; a literal "true" here would be a stuck spinner to a
        // screen-reader user long after the action completed.
        expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).not.toBe('true');
    });
    it('forwards a ref to the Pressable — the handle a leaf needs to move screen-reader focus onto it', () => {
        const ref = createRef<View>();

        render(
            <PressScale ref={ref} onPress={vi.fn()} accessibilityLabel="Create food">
                <Text>Create food</Text>
            </PressScale>,
        );

        expect(ref.current).toBe(screen.getByRole('button', { name: 'Create food' }));
    });

    it('projects `expanded` as disclosure state, and says NOTHING when the control is not a disclosure', () => {
        const { rerender } = render(
            <PressScale onPress={vi.fn()} expanded accessibilityLabel="Create food">
                <Text>Create food</Text>
            </PressScale>,
        );
        expect(screen.getByRole('button', { name: 'Create food' }).getAttribute('aria-expanded')).toBe('true');

        rerender(
            <PressScale onPress={vi.fn()} expanded={false} accessibilityLabel="Create food">
                <Text>Create food</Text>
            </PressScale>,
        );
        // `false` means COLLAPSED, which is a statement — not the same as absent.
        expect(screen.getByRole('button', { name: 'Create food' }).getAttribute('aria-expanded')).toBe('false');

        rerender(
            <PressScale onPress={vi.fn()} accessibilityLabel="Create food">
                <Text>Create food</Text>
            </PressScale>,
        );
        expect(screen.getByRole('button', { name: 'Create food' }).hasAttribute('aria-expanded')).toBe(false);
    });
});
