/**
 * TextInput (native) — the one React Native `TextInput` the apps render, so no field opens Android's full-screen editor
 * (`docs/design/compactHeightLayout.md` §7).
 *
 * In landscape on a phone, Android may take the whole window for a text field's editor unless `disableFullscreenUI` is
 * set. That editor hides everything a field means beside: its label (SC 3.3.2), a search's results, the phrase the
 * erase dialog asks the cook to copy, and which ingredient row a quantity belongs to. The adapter fixes the prop for
 * every field and takes it out of the API.
 *
 * ⚠️ The real `TextInput` is wrapped to record the props it was given: react-native-web has no full-screen editor, so
 * the recorded prop is the contract, and a device check is the proof.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement, createRef, type ComponentProps } from 'react';
import type { TextInput as NativeTextInput, TextInput as TextInputType } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextInput } from '../TextInput.native.js';

const state = vi.hoisted(() => ({ props: undefined as ComponentProps<typeof TextInputType> | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        TextInput: (props: ComponentProps<typeof TextInputType>) => {
            state.props = props;

            return createElement(actual.TextInput, props);
        },
    };
});

afterEach(() => {
    cleanup();
    state.props = undefined;
});

describe('TextInput (native)', () => {
    it('never lets Android open its full-screen editor', () => {
        render(<TextInput accessibilityLabel="Search recipes" />);

        expect(state.props?.disableFullscreenUI).toBe(true);
    });

    it('cannot be talked out of it, even by a prop smuggled past the type', () => {
        const smuggled = { disableFullscreenUI: false } as unknown as ComponentProps<typeof TextInput>;

        render(<TextInput accessibilityLabel="Search recipes" {...smuggled} />);

        expect(state.props?.disableFullscreenUI).toBe(true);
    });

    it('passes every other prop through', () => {
        const onChangeText = vi.fn();

        render(
            <TextInput
                accessibilityLabel="Search recipes"
                placeholder="Search recipes..."
                value="lamb"
                multiline
                onChangeText={onChangeText}
            />,
        );

        expect(state.props).toMatchObject({
            accessibilityLabel: 'Search recipes',
            placeholder: 'Search recipes...',
            value: 'lamb',
            multiline: true,
            onChangeText,
        });
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
    });

    // React 19 hands a function component its `ref` as a prop, so the spread forwards it: the ingredient picker's
    // `focusSearch` still reaches the field.
    it('forwards a ref to the native field, so a caller can still focus it', () => {
        const ref = createRef<NativeTextInput>();

        render(<TextInput ref={ref} accessibilityLabel="Search ingredients" />);

        expect(typeof ref.current?.focus).toBe('function');
    });
});
