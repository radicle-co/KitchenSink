/**
 * The group-name field and the chip input (native) — what VoiceOver and TalkBack receive.
 *
 * iOS ignores `aria-labelledby` and React Native has no `aria-describedby`; react-native-web maps both to the DOM, so a
 * DOM query passes while a device does nothing. These suites wrap the text input to record the accessibility props each
 * field is handed: its visible label as `accessibilityLabel`, and the visible hint as `accessibilityHint`.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordedTextInput, recordedTextInputs } from '@commise/ui/testing/record-text-inputs';

vi.mock('@commise/ui/text-input', async (importOriginal) => {
    const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');

    return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
});

import { ChipInput } from '../ChipInput.native.js';
import { GroupNameField } from '../GroupNameField.native.js';
import type { GroupNameFieldView } from '../useIngredientGroups.js';

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
});

const groupName: GroupNameFieldView = {
    id: 'group-name',
    label: 'Group name',
    value: 'Sauce',
    saveLabel: 'Save',
    cancelLabel: 'Cancel',
    focusRequested: false,
    onFocusRequestHandled: vi.fn(),
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
};

describe('GroupNameField (native)', () => {
    it('names the field by its visible label for iOS', () => {
        render(<GroupNameField field={groupName} />);

        expect(recordedTextInput('group-name').accessibilityLabel).toBe('Group name');
    });
});

describe('ChipInput (native)', () => {
    it('names the field by its visible label for iOS and speaks the visible hint', () => {
        render(
            <ChipInput
                id="recipe-tags"
                label="Tags"
                hint="Separate tags with commas."
                values={[]}
                onChange={vi.fn()}
                removeChipLabel="Remove {value}"
                addLabel="Add tag"
            />,
        );

        expect(recordedTextInput('recipe-tags').accessibilityLabel).toBe('Tags');
        expect(recordedTextInput('recipe-tags').accessibilityHint).toBe('Separate tags with commas.');
    });
});
