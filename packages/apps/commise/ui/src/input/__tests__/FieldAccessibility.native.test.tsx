/**
 * Input and TextArea (native) — what VoiceOver and TalkBack actually receive (`docs/design/uiOverhaul/cuisineField.md`
 * §3.3 follow-up).
 *
 * React Native 0.86 has no `aria-describedby`, no `aria-invalid`, and `aria-labelledby` is Android-only. react-native-web,
 * which the sibling suite runs on, maps all three to the DOM, so that suite passes while a device does nothing. So this
 * suite stands in for the platform's text input and reads the props the leaves hand it: the `error` leads the field's
 * `accessibilityHint`, and the `label` is its `accessibilityLabel`, the name iOS reads.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextInput as TextInputAdapter } from '../../textInput/TextInput.native.js';
import { Input } from '../Input.native.js';
import { TextArea } from '../TextArea.native.js';

const seen = vi.hoisted(() => ({ props: undefined as ComponentProps<typeof TextInputAdapter> | undefined }));

vi.mock('../../textInput/TextInput.native.js', () => ({
    TextInput: (props: ComponentProps<typeof TextInputAdapter>) => {
        seen.props = props;

        return null;
    },
}));

afterEach(cleanup);

const MESSAGE = 'Add a title to publish.';

const leaves = [
    ['Input', (extra: object) => <Input id="title" value="" onChangeText={vi.fn()} {...extra} />],
    ['TextArea', (extra: object) => <TextArea id="title" value="" onChangeText={vi.fn()} minRows={2} {...extra} />],
] as const;

describe.each(leaves)('%s (native) — what the screen reader receives', (_name, field) => {
    it('hands the error to the field as its accessibility hint', () => {
        render(field({ error: MESSAGE }));

        expect(seen.props?.accessibilityHint).toBe(MESSAGE);
    });

    it('has no hint at all without an error, so nothing is spoken for it', () => {
        render(field({}));

        expect(seen.props?.accessibilityHint).toBeUndefined();
    });

    it('names the field by its label as an accessibility label, which iOS reads', () => {
        render(field({ label: 'Title' }));

        expect(seen.props?.accessibilityLabel).toBe('Title');
    });

    it('sets no accessibility label when it is not given one, rather than an empty name', () => {
        render(field({}));

        expect(seen.props?.accessibilityLabel).toBeUndefined();
    });

    it('keeps the labelled-by link Android reads', () => {
        render(field({ label: 'Title' }));

        expect(seen.props?.['aria-labelledby']).toBe('title-label');
    });

    it('hands the field no aria-invalid or aria-describedby, which React Native 0.86 compiles and ignores on device', () => {
        render(field({ error: MESSAGE, invalid: true, describedBy: 'title-error' }));

        expect(seen.props).not.toHaveProperty('aria-invalid');
        expect(seen.props).not.toHaveProperty('aria-describedby');
    });

    it('takes the danger edge from the error alone, without `invalid`', () => {
        const edge = () => StyleSheet.flatten(seen.props?.style)?.borderColor;
        render(field({}));
        const resting = edge();
        cleanup();
        render(field({ error: MESSAGE }));

        expect(edge()).not.toBe(resting);
    });
});
