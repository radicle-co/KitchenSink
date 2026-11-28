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
import { SOURCE_LINK_INPUT_MAX_LENGTH } from '@kitchensink/recipe-core';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

// react-native-web drops `accessibilityHint`, so the field is wrapped to record the accessibility props a screen reader is
// actually given (`recordedTextInput`).
vi.mock('@commise/ui/text-input', async (importOriginal) => {
    const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');

    return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { render } from '@commise/ui/testing/tamagui';
import { recipeActionMessages } from '../../actions/messages.js';
import { editorMessages } from '../../editor/messages.js';
import { sourceFieldId } from '../fieldIds.js';
import { RecipeSourceField } from '../RecipeSourceField.native.js';
import type { SourceRowModel } from '../sourceLink.js';

const m = editorMessages.en.source;
const a = recipeActionMessages.en.sourceStatement;
const URL = 'https://www.allrecipes.com/recipe/1/soup/';

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
});

function renderRow(row: SourceRowModel, over: Partial<Parameters<typeof RecipeSourceField>[0]> = {}) {
    const handlers = {
        onChange: vi.fn(),
        onRemove: vi.fn(),
        onOpen: vi.fn(),
        onTouched: vi.fn(),
        onAsk: vi.fn(),
    };

    render(<RecipeSourceField row={row} {...handlers} {...over} />);

    return handlers;
}

const field = () => screen.getByRole<HTMLInputElement>('textbox', { name: m.label });

describe('RecipeSourceField (native)', () => {
    it('after a downgrade the screen reader moves to the answer, which the closed sheet left nowhere', () => {
        const row: SourceRowModel = { kind: 'lockedAnswer', answer: 'book', citation: 'Joy' };
        const handlers = { onChange: vi.fn(), onRemove: vi.fn(), onOpen: vi.fn(), onTouched: vi.fn(), onAsk: vi.fn() };
        const { rerender } = render(<RecipeSourceField row={row} {...handlers} focusSignal={0} />);

        expect(focus.moved).not.toHaveBeenCalled();
        rerender(<RecipeSourceField row={row} {...handlers} focusSignal={1} />);

        expect(focus.moved).toHaveBeenCalledTimes(1);
        expect(focus.moved.mock.calls[0]?.[1]).toBe('focus');
    });

    it('empty: a labelled URL field with the hint, and no Remove', () => {
        renderRow({ kind: 'empty', text: '' });

        expect(field().value).toBe('');
        expect(screen.getByText(m.hint)).toBeTruthy();
        expect(recordedTextInput(sourceFieldId).accessibilityHint).toBe(m.hint);
        expect(screen.queryByRole('button', { name: m.remove })).toBeNull();
    });

    it('caps how much text the field takes, a little over the longest source link', () => {
        renderRow({ kind: 'empty', text: '' });

        expect(field().maxLength).toBe(SOURCE_LINK_INPUT_MAX_LENGTH);
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

    it('lockedAnswer, paid site: the label, "From a paid website", the citation as plain text, the reason, and no link, field or Remove', () => {
        renderRow({ kind: 'lockedAnswer', answer: 'paidSite', citation: 'https://paid.example/recipe' });

        expect(screen.getByText(m.label)).toBeTruthy();
        expect(screen.getByText('From a paid website')).toBeTruthy();
        expect(screen.getByText('https://paid.example/recipe')).toBeTruthy();
        expect(screen.getByText(m.locked)).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('button', { name: m.remove })).toBeNull();
    });

    it('lockedAnswer, from another person: the label, the answer, the reason, and no citation, link, field or Remove', () => {
        renderRow({ kind: 'lockedAnswer', answer: 'fromPerson' });

        expect(screen.getByText(m.label)).toBeTruthy();
        expect(screen.getByText(a.answerPerson)).toBeTruthy();
        expect(screen.getByText(m.locked)).toBeTruthy();
        expect(screen.queryByText(a.answerPaidSite)).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('button', { name: m.remove })).toBeNull();
    });

    it('lockedAnswer, unrecognised statement kind: the label and the reason, and no answer line', () => {
        renderRow({ kind: 'lockedAnswer' });

        expect(screen.getByText(m.label)).toBeTruthy();
        expect(screen.getByText(m.locked)).toBeTruthy();
        expect(screen.queryByText(a.answerPerson)).toBeNull();
        expect(screen.queryByText(a.answerPaidSite)).toBeNull();
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

const HELP = 'https://commise.app/support?recipe=r1';

describe('RecipeSourceField (native): the row after the lock (ADR-0100)', () => {
    it.each([
        ['a locked web page', { kind: 'locked', site: 'allrecipes.com', url: URL }],
        ['a locked book', { kind: 'lockedAnswer', answer: 'book', citation: 'The Sunday Roast Book' }],
        ['a locked paid site', { kind: 'lockedAnswer', answer: 'paidSite', citation: 'Sam’s Kitchen' }],
        ['another person', { kind: 'lockedAnswer', answer: 'fromPerson' }],
        ['an answer this app cannot word', { kind: 'lockedAnswer' }],
    ] as const)('%s: says who can change it, and the link opens the support page in the browser', (_name, row) => {
        const { onOpen } = renderRow(row, { askHref: HELP });

        fireEvent.click(screen.getByRole('link', { name: m.askChangeNative }));

        expect(onOpen).toHaveBeenCalledWith(HELP);
        expect(screen.getByText(m.locked)).toBeTruthy();
    });

    it('draws no help link when no support address is set, and the locked line still reads true', () => {
        renderRow({ kind: 'lockedAnswer', answer: 'book', citation: '' });

        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText(m.locked)).toBeTruthy();
    });

    it('a locked book names the answer and its title', () => {
        renderRow({ kind: 'lockedAnswer', answer: 'book', citation: 'The Sunday Roast Book' });

        expect(screen.getByText(a.answerBook)).toBeTruthy();
        expect(screen.getByText('The Sunday Roast Book')).toBeTruthy();
    });

    it('own: the answer and one button to change it, no locked line, and the other-source link in its own words', () => {
        const { onAsk, onOpen } = renderRow({ kind: 'own' }, { askHref: HELP });

        expect(screen.getByText(a.answerAuthored)).toBeTruthy();
        expect(screen.queryByText(m.locked)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: m.changeOwn }));
        expect(onAsk).toHaveBeenCalledWith('downgrade');
        fireEvent.click(screen.getByRole('link', { name: m.askOtherNative }));
        expect(onOpen).toHaveBeenCalledWith(HELP);
        expect(screen.queryByRole('link', { name: m.askChangeNative })).toBeNull();
    });

    it('open, answered: the stored book, its title, the warning, and the control that changes the answer', () => {
        const { onAsk } = renderRow({ kind: 'openAnswered', answer: 'book', citation: 'The Sunday Roast Book' });

        expect(screen.getByText(a.answerBook)).toBeTruthy();
        expect(screen.getByText('The Sunday Roast Book')).toBeTruthy();
        expect(screen.getByText(m.lockWarning)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: m.changeAnswer }));
        expect(onAsk).toHaveBeenCalledWith('change');
    });

    it('open, none: the field with no warning, and the button that says where it is from', () => {
        const { onAsk } = renderRow({ kind: 'empty', text: '' }, { askHref: HELP });

        expect(screen.queryByText(m.lockWarning)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: m.sayWhere }));
        expect(onAsk).toHaveBeenCalledWith('firstAnswer');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('a filled link warns that publishing locks it, or that the next save does once confirmed', () => {
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false });
        expect(screen.getByText(m.lockWarning)).toBeTruthy();
        expect(recordedTextInput(sourceFieldId).accessibilityHint).toContain(m.lockWarning);
        cleanup();

        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false, confirmed: true });
        expect(screen.getByText(m.lockWarningSave)).toBeTruthy();
        expect(screen.queryByText(m.lockWarning)).toBeNull();
    });
});
