import { cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TextInputProps } from '../../textInput/TextInput.native.js';
import {
    recordedTextInput,
    recordedTextInputLabelled,
    recordedTextInputs,
    recordingTextInputModule,
} from '../recordTextInputs.native.js';

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
});

const Real: FC<TextInputProps> = ({ nativeID, value }) => <output id={nativeID}>{value}</output>;
const { TextInput } = recordingTextInputModule({ TextInput: Real, other: 'kept' });

describe('the recording TextInput', () => {
    // Why it exists: react-native-web drops `accessibilityHint`, so a DOM query cannot see what a screen reader is told.
    // This double keeps the REAL field rendering (a host's flow still runs) and lets a test read the props it was handed.
    it('still renders the real field', () => {
        render(<TextInput nativeID="title" value="Soup" />);

        expect(screen.getByRole('status').textContent).toBe('Soup');
    });

    it('records the props each field was handed, keyed by its nativeID', () => {
        render(
            <>
                <TextInput nativeID="title" accessibilityHint="Add a title." />
                <TextInput nativeID="notes" accessibilityLabel="Notes" />
            </>,
        );

        expect(recordedTextInput('title').accessibilityHint).toBe('Add a title.');
        expect(recordedTextInput('notes').accessibilityLabel).toBe('Notes');
    });

    it('keys a field that has no nativeID by its accessibilityLabel', () => {
        render(<TextInput accessibilityLabel="Protein" accessibilityHint="Out of range." />);

        expect(recordedTextInput('Protein').accessibilityHint).toBe('Out of range.');
    });

    it('keeps the latest props when a field re-renders', () => {
        const { rerender } = render(<TextInput nativeID="title" accessibilityHint="first" />);
        rerender(<TextInput nativeID="title" accessibilityHint="second" />);

        expect(recordedTextInput('title').accessibilityHint).toBe('second');
    });

    it('keeps the rest of the module it wraps', () => {
        expect(recordingTextInputModule({ TextInput: Real, other: 'kept' }).other).toBe('kept');
    });

    it('throws, naming the id, when no field with that id rendered, so a typo cannot pass as "no hint"', () => {
        expect(() => recordedTextInput('missing')).toThrow('missing');
    });

    it('finds a field by its accessibilityLabel when its nativeID is generated', () => {
        render(<TextInput nativeID=":r1:" accessibilityLabel="Display name" accessibilityHint="Too long." />);

        expect(recordedTextInputLabelled('Display name').accessibilityHint).toBe('Too long.');
    });

    it('throws, naming the label, when no field carries it', () => {
        expect(() => recordedTextInputLabelled('Nothing')).toThrow('Nothing');
    });
});
