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
