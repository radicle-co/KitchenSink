import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PressScale } from '../PressScale.native.js';

/**
 * PressScale (native) — rendered via react-native-web under jsdom. The native leaf OWNS the interaction
 * (it renders the Pressable), so we assert the interaction contract here (name/role, press, disabled
 * guard) plus that the `pressedScale`-driven `transform` is wired onto the element. The pressed↔release and
 * reduce-motion SUPPRESSION branches are proven deterministically by the pure `pressedScale.test.ts`
 * (react-native-web's Pressable does not toggle its `pressed` state from synthetic jsdom events, so the
 * branch is unit-tested at its source rather than asserted flakily through the renderer).
 */

afterEach(cleanup);

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

    it('wires the pressedScale-driven transform onto the pressable (resting = neutral scale)', () => {
        render(
            <PressScale onPress={vi.fn()} accessibilityLabel="Tap me">
                <Text>Tap me</Text>
            </PressScale>,
        );

        // The transform pipeline is present and, at rest, neutral — the pressed (0.98) and reduce-motion
        // (suppressed) outputs of that same pipeline are proven in pressedScale.test.ts.
        expect(screen.getByRole('button', { name: 'Tap me' }).style.transform).toBe('scale(1)');
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
});
