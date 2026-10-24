/**
 * Stepper (native) — what VoiceOver and TalkBack actually receive for the field's error and name
 * (`docs/design/uiOverhaul/cuisineField.md` §3.3, P4).
 *
 * React Native 0.86 has no `aria-describedby`, no `aria-invalid`, and `aria-labelledby` is Android-only.
 * react-native-web maps those to the DOM, so a DOM suite passes while a device does nothing. This suite stands in for
 * `Pressable` and reads the props the leaf hands it: the `error` is the accessibility hint of both buttons (the cursor
 * lands on the buttons, not on the group), and the group's `label` is its `accessibilityLabel`, the name iOS reads.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({
    buttons: [] as Record<string, unknown>[],
    groups: [] as Record<string, unknown>[],
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        Pressable: (props: Record<string, unknown>) => {
            seen.buttons.push(props);

            return null;
        },
        View: (props: Record<string, unknown>) => {
            if (props['role'] === 'group') {
                seen.groups.push(props);
            }

            return createElement(actual.View, props);
        },
    };
});

import { Stepper } from '../Stepper.native.js';

afterEach(() => {
    cleanup();
    seen.buttons = [];
    seen.groups = [];
});

const MESSAGE = 'Servings must be at least 1.';

const renderField = (error?: string) =>
    render(
        <Stepper
            id="servings"
            label="Servings"
            value={2}
            onChange={vi.fn()}
            announce={(n) => `Serves ${String(n)}`}
            decreaseLabel="Fewer servings"
            increaseLabel="More servings"
            {...(error === undefined ? {} : { error })}
        />,
    );

describe('Stepper (native) — the error and the name a screen reader receives', () => {
    it('hands the error to BOTH buttons as their accessibility hint', () => {
        renderField(MESSAGE);

        expect(seen.buttons.map((button) => button['accessibilityHint'])).toEqual([MESSAGE, MESSAGE]);
    });

    it('has no hint without an error', () => {
        renderField();

        expect(seen.buttons.map((button) => button['accessibilityHint'])).toEqual([undefined, undefined]);
    });

    it('names the group by its label as an accessibility label, which iOS reads', () => {
        renderField();

        expect(seen.groups.at(-1)?.['accessibilityLabel']).toBe('Servings');
    });

    it('hands no aria-invalid or aria-describedby to anything, which React Native ignores on device', () => {
        renderField(MESSAGE);

        for (const node of [...seen.buttons, ...seen.groups]) {
            expect(node).not.toHaveProperty('aria-invalid');
            expect(node).not.toHaveProperty('aria-describedby');
        }
    });
});
