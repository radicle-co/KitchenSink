/**
 * Combobox (native) — the field's own error (`error`, `docs/design/uiOverhaul/cuisineField.md` §3.3, §4 P4).
 *
 * React Native 0.86 has no `aria-describedby`, no `aria-invalid` and no invalid accessibility state, so the error reaches
 * VoiceOver and TalkBack as the lead of the input's `accessibilityHint`. react-native-web maps the aria props to the DOM
 * and so would pass a test of them in jsdom while doing nothing on a device. So this suite stands in for the platform's
 * text input, reads the props the leaf hands it, and asserts the hint text, never `aria-invalid`.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextInput as TextInputAdapter } from '../../textInput/TextInput.native.js';
import { Combobox } from '../Combobox.native.js';

const seen = vi.hoisted(() => ({ props: undefined as ComponentProps<typeof TextInputAdapter> | undefined }));

vi.mock('../../textInput/TextInput.native.js', () => ({
    TextInput: (props: ComponentProps<typeof TextInputAdapter>) => {
        seen.props = props;

        return null;
    },
}));

afterEach(cleanup);

const MESSAGE = 'Choose a cuisine, or type your own.';

const renderField = (
    over: Partial<Pick<ComponentProps<typeof Combobox>, 'labelVisibility' | 'hint' | 'error' | 'belowField'>>,
) =>
    render(
        <Combobox
            id="cuisine"
            label="Cuisine"
            listLabel="Cuisine suggestions"
            value=""
            onValueChange={vi.fn()}
            groups={[]}
            onSelect={vi.fn()}
            countAnnouncement=""
            {...over}
        />,
    );

describe('Combobox (native) — the field’s own error', () => {
    it('leads the accessibility hint with the error, a space, then the hint', () => {
        renderField({ error: MESSAGE, hint: 'Choose one, or type your own.' });

        expect(seen.props?.accessibilityHint).toBe(`${MESSAGE} Choose one, or type your own.`);
    });

    it('makes the hint the error alone with no hint', () => {
        renderField({ error: MESSAGE });

        expect(seen.props?.accessibilityHint).toBe(MESSAGE);
    });

    it('leaves the hint as it was without an error', () => {
        renderField({ hint: 'Choose one.' });

        expect(seen.props?.accessibilityHint).toBe('Choose one.');
    });

    it('speaks the error with the label hidden too', () => {
        renderField({ labelVisibility: 'hidden', error: MESSAGE, hint: 'Choose one.' });

        expect(seen.props?.accessibilityHint).toBe(`${MESSAGE} Choose one.`);
    });

    it('draws the message as plain text with no role and no live region', () => {
        const { getByText, queryByRole } = renderField({ error: MESSAGE });
        const message = getByText(MESSAGE);

        expect(message.getAttribute('role')).toBeNull();
        expect(queryByRole('alert')?.textContent ?? '').toBe('');
        expect(message.closest('[aria-live]')).toBeNull();
    });

    it('draws it before the host’s line under the field', () => {
        const { getByText } = renderField({ error: MESSAGE, belowField: <span>Live reading</span> });

        expect(getByText(MESSAGE).compareDocumentPosition(getByText('Live reading'))).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('takes the danger edge from the error alone, without `invalid`', () => {
        const edge = () => StyleSheet.flatten(seen.props?.style)?.borderColor;
        renderField({});
        const resting = edge();
        cleanup();
        renderField({ error: MESSAGE });

        expect(edge()).not.toBe(resting);
    });

    it('draws nothing without an error', () => {
        const { queryByText } = renderField({ hint: 'Choose one.' });

        expect(queryByText(MESSAGE)).toBeNull();
    });
});
