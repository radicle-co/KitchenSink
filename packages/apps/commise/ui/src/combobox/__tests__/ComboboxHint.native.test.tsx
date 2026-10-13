/**
 * Combobox (native) — the hint reaches TalkBack and VoiceOver (A-007, E13; build spec §7.4).
 *
 * React Native has no `aria-describedby` (`RecipeIngredientsFields.native.tsx` records it), so a caption drawn under the
 * label is not what a screen reader reads when the field takes focus: the field's `accessibilityHint` is. react-native-web,
 * which the sibling suite runs on, implements neither, so this suite stands in for the platform's text input and reads the
 * props the leaf hands it.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
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

const renderField = (over: { readonly labelVisibility?: 'visible' | 'hidden'; readonly hint?: string }) =>
    render(
        <Combobox
            id="add-ingredient"
            label="Add an ingredient"
            listLabel="Food suggestions"
            value=""
            onValueChange={vi.fn()}
            groups={[]}
            onSelect={vi.fn()}
            countAnnouncement=""
            {...over}
        />,
    );

describe('Combobox (native) — the hint the screen reader speaks', () => {
    it('hands the hint to the field as its accessibility hint with the label drawn, as well as drawing it', () => {
        renderField({ hint: 'Type the amount first.' });

        expect(seen.props?.accessibilityHint).toBe('Type the amount first.');
    });

    it('hands it over with the label hidden too', () => {
        renderField({ labelVisibility: 'hidden', hint: 'Type to search foods.' });

        expect(seen.props?.accessibilityHint).toBe('Type to search foods.');
    });

    it('names the field by its label and registers it under its id for the label to focus', () => {
        renderField({});

        expect(seen.props?.accessibilityLabel).toBe('Add an ingredient');
        expect(seen.props?.nativeID).toBe('add-ingredient');
    });
});
