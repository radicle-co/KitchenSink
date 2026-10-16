/**
 * Input (native) — what the return key does (`docs/design/uiOverhaul/specSharedSystem.md` §16.1).
 *
 * A single-line React Native field blurs on return unless it is told otherwise, so `enterKeyHint="next"` closed the
 * keyboard and no field took focus. React Native 0.86 reads `submitBehavior`; react-native-web does not, so a DOM
 * query cannot see it. This suite stands in for the platform's text input and reads the props the leaf hands it, as
 * `FieldAccessibility.native.test.tsx` does, and fires `onSubmitEditing` the way a device does.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextInput as TextInputAdapter } from '../../textInput/TextInput.native.js';
import { Input } from '../Input.native.js';
import type { EnterKeyHint } from '../props.js';

const seen = vi.hoisted(() => ({ props: undefined as ComponentProps<typeof TextInputAdapter> | undefined }));

vi.mock('../../textInput/TextInput.native.js', () => ({
    TextInput: (props: ComponentProps<typeof TextInputAdapter>) => {
        seen.props = props;

        return null;
    },
}));

afterEach(cleanup);

function renderField(extra: { readonly enterKeyHint?: EnterKeyHint; readonly onSubmit?: () => void }): void {
    render(<Input id="email" value="" onChangeText={vi.fn()} {...extra} />);
}

describe('Input (native) — the return key', () => {
    it('keeps the keyboard up on `next`, so the host can move focus to the following field', () => {
        renderField({ enterKeyHint: 'next' });

        expect(seen.props?.submitBehavior).toBe('submit');
    });

    it.each<EnterKeyHint>(['go', 'done', 'search', 'send'])('closes the keyboard on `%s`', (hint) => {
        renderField({ enterKeyHint: hint });

        expect(seen.props?.submitBehavior).toBe('blurAndSubmit');
    });

    it('closes the keyboard when the field names no key', () => {
        renderField({});

        expect(seen.props?.submitBehavior).toBe('blurAndSubmit');
    });

    it('hands the host the submit', () => {
        const onSubmit = vi.fn();
        renderField({ enterKeyHint: 'next', onSubmit });

        seen.props?.onSubmitEditing?.({} as never);

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});
