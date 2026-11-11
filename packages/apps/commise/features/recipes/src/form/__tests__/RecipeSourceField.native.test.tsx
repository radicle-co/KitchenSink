/**
 * Native component tests for the Source row in Photos & publish (ADR-0089), rendered through react-native-web under jsdom.
 * Mirrors `RecipeSourceField.test.tsx`: one case per state of the editor spec's table. What differs from web is asserted
 * here: the field's accessibility hint carries the status and the error (React Native has no `aria-describedby`), and the
 * locked site opens in the browser through the injected `onOpen`.
 */
import { fireEvent } from '@testing-library/dom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordedTextInput, recordedTextInputs } from '@commise/ui/testing/record-text-inputs';

// react-native-web drops `accessibilityHint`, so the field is wrapped to record the accessibility props a screen reader is
// actually given (`recordedTextInput`).
vi.mock('@commise/ui/text-input', async (importOriginal) => {
    const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');

    return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { render } from '@commise/ui/testing/tamagui';
import { editorMessages } from '../../editor/messages.js';
import { sourceFieldId } from '../fieldIds.js';
import { RecipeSourceField } from '../RecipeSourceField.native.js';
import type { SourceRowModel } from '../sourceLink.js';

const m = editorMessages.en.source;
const URL = 'https://www.allrecipes.com/recipe/1/soup/';

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
});

function renderRow(row: SourceRowModel, over: Partial<Parameters<typeof RecipeSourceField>[0]> = {}) {
    const handlers = {
        onChange: vi.fn(),
        onRemove: vi.fn(),
        onFocusHandled: vi.fn(),
        onOpen: vi.fn(),
        onTouched: vi.fn(),
    };

    render(<RecipeSourceField row={row} focusRequested={false} {...handlers} {...over} />);

    return handlers;
}

const field = () => screen.getByRole<HTMLInputElement>('textbox', { name: m.label });

describe('RecipeSourceField (native)', () => {
    it('empty: a labelled URL field with the hint, and no Remove', () => {
        renderRow({ kind: 'empty', text: '' });

        expect(field().value).toBe('');
        expect(screen.getByText(m.hint)).toBeTruthy();
        expect(recordedTextInput(sourceFieldId).accessibilityHint).toBe(m.hint);
        expect(screen.queryByRole('button', { name: m.remove })).toBeNull();
    });

    it('typing reports the text', () => {
        const { onChange } = renderRow({ kind: 'empty', text: '' });

        fireEvent.change(field(), { target: { value: URL } });

        expect(onChange).toHaveBeenCalledWith(URL);
    });

    it('filled: says it is copied from a public web page and which site, and offers Remove', () => {
        const { onRemove } = renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false });

        expect(screen.getByText('Copied from a public web page · allrecipes.com')).toBeTruthy();
        expect(recordedTextInput(sourceFieldId).accessibilityHint).toContain('allrecipes.com');

        fireEvent.click(screen.getByRole('button', { name: m.remove }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('filled from a paste: says it was added from the paste, and not otherwise', () => {
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: true });

        expect(screen.getByText(m.fromPaste)).toBeTruthy();

        cleanup();
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false });

        expect(screen.queryByText(m.fromPaste)).toBeNull();
    });

    it('invalid: the error is drawn and given to the field, and Remove clears it', () => {
        renderRow({ kind: 'invalid', text: 'soup' });

        expect(screen.getByText(m.invalid)).toBeTruthy();
        expect(recordedTextInput(sourceFieldId).accessibilityHint).toContain(m.invalid);
        expect(screen.getByRole('button', { name: m.remove })).toBeTruthy();
    });

    it('a Commise link: its own error', () => {
        renderRow({ kind: 'ownSite', text: 'https://commise.app/en' });

        expect(screen.getByText(m.ownSite)).toBeTruthy();
        expect(screen.queryByText(m.invalid)).toBeNull();
    });

    it('locked: the site opens in the browser, with the address, the reason, and no field and no Remove', () => {
        const { onOpen } = renderRow({ kind: 'locked', site: 'allrecipes.com', url: URL });

        fireEvent.click(screen.getByRole('link', { name: 'allrecipes.com, opens in your browser' }));

        expect(onOpen).toHaveBeenCalledWith(URL);
        expect(screen.getByText(URL)).toBeTruthy();
        expect(screen.getByText(m.locked)).toBeTruthy();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('button', { name: m.remove })).toBeNull();
    });

    it('hidden: nothing at all', () => {
        renderRow({ kind: 'hidden' });

        expect(screen.queryByText(m.label)).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('half-typed text is not an error yet, and can already be cleared', () => {
        renderRow({ kind: 'empty', text: 'https://exa' });

        expect(screen.queryByText(m.invalid)).toBeNull();
        expect(screen.getByRole('button', { name: m.remove })).toBeTruthy();
    });
});
