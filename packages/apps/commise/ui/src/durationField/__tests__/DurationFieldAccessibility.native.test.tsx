/**
 * DurationField (native) — what VoiceOver and TalkBack actually receive for the field's error and name
 * (`docs/design/uiOverhaul/cuisineField.md` §3.3, P4).
 *
 * React Native 0.86 has no `aria-describedby`, no `aria-invalid`, and `aria-labelledby` is Android-only. react-native-web,
 * which the sibling suite runs on, maps those to the DOM, so that suite passes while a device does nothing. This suite
 * stands in for the platform's text input and reads the props each box is handed: the `error` is each box's
 * `accessibilityHint`, because the boxes are what the screen-reader cursor lands on.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextInput as TextInputAdapter } from '../../textInput/TextInput.native.js';
import { DurationField } from '../DurationField.native.js';

const seen = vi.hoisted(() => ({ boxes: [] as ComponentProps<typeof TextInputAdapter>[] }));

vi.mock('../../textInput/TextInput.native.js', () => ({
    TextInput: (props: ComponentProps<typeof TextInputAdapter>) => {
        seen.boxes.push(props);

        return null;
    },
}));

afterEach(() => {
    cleanup();
    seen.boxes = [];
});

const MESSAGE = 'Prep and cook time cannot be more than a day.';

const renderField = (error?: string) =>
    render(
        <DurationField
            label="Prep time"
            hoursLabel="Prep time, hours"
            minutesLabel="Prep time, minutes"
            hoursUnit="h"
            minutesUnit="min"
            value={undefined}
            onChange={vi.fn()}
            {...(error === undefined ? {} : { error })}
        />,
    );

describe('DurationField (native) — the error and the name a screen reader receives', () => {
    it('hands the error to BOTH boxes as their accessibility hint', () => {
        renderField(MESSAGE);

        expect(seen.boxes.map((box) => box.accessibilityHint)).toEqual([MESSAGE, MESSAGE]);
    });

    it('has no hint without an error, so nothing is spoken for it', () => {
        renderField();

        expect(seen.boxes.map((box) => box.accessibilityHint)).toEqual([undefined, undefined]);
    });

    it('keeps each box named by its own label', () => {
        renderField(MESSAGE);

        expect(seen.boxes.map((box) => box.accessibilityLabel)).toEqual(['Prep time, hours', 'Prep time, minutes']);
    });

    it('draws both boxes with the danger edge from the error alone', () => {
        const edge = () => seen.boxes.map((box) => StyleSheet.flatten(box.style)?.borderColor);
        renderField();
        const resting = edge();
        cleanup();
        seen.boxes = [];
        renderField(MESSAGE);

        expect(edge()).not.toEqual(resting);
    });

    it('hands the boxes no aria-invalid or aria-describedby, which React Native ignores on device', () => {
        renderField(MESSAGE);

        for (const box of seen.boxes) {
            expect(box).not.toHaveProperty('aria-invalid');
            expect(box).not.toHaveProperty('aria-describedby');
        }
    });
});
