/**
 * Native component tests for the Paste a list sheet (build spec §7.5.4, §7.12), through react-native-web under jsdom.
 * Mirrors `PasteListSheet.test.tsx`. Native reads no clipboard itself: the field's system paste menu pastes (Settled 34).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { FC } from 'react';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

import { editorMessages } from '../../editor/messages.js';
import type { PasteIntoIngredients } from '../../editor/usePasteIntoIngredients.js';
import { usePasteListSheet } from '../../editor/usePasteListSheet.js';
import { recipeFormMessages } from '../messages.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PasteListSheet } from '../PasteListSheet.native.js';

afterEach(cleanup);

const t = editorMessages.en.ingredients;
const form = recipeFormMessages.en;

const fakePaste = (over: Partial<PasteIntoIngredients> = {}): PasteIntoIngredients => ({
    available: true,
    submit: vi.fn(),
    submitting: false,
    failed: false,
    clearFailure: vi.fn(),
    acceptedCount: 0,
    reading: [],
    retry: vi.fn(),
    added: undefined,
    ...over,
});

const Host: FC<{ readonly paste: PasteIntoIngredients }> = ({ paste }) => {
    const sheet = usePasteListSheet(paste, {
        initiallyOpen: true,
        copy: { lineTooLong: form.pasteRefusalLineTooLong, tooManyLines: form.pasteRefusalTooManyLines },
    });

    return <PasteListSheet sheet={sheet} submitting={paste.submitting} failed={paste.failed} />;
};

const field = (): HTMLTextAreaElement => screen.getByRole<HTMLTextAreaElement>('textbox', { name: t.pasteLabel });

describe('PasteListSheet (native)', () => {
    it('is a sheet titled "Paste a list" with the labelled field and its hint', () => {
        render(<Host paste={fakePaste()} />);

        expect(screen.getByRole('heading', { name: t.pasteTitle })).toBeTruthy();
        expect(field()).toBeTruthy();
        expect(screen.getByText(t.pasteHint)).toBeTruthy();
    });

    // F11 (`evaluateFinal.md`; `buildSpec.md` §5.1): the primary fills the sheet and the × is the only way out, as the
    // New collection sheet does on a phone.
    it('fills the primary and has no Cancel', () => {
        render(<Host paste={fakePaste()} />);

        expect(screen.getByRole('button', { name: 'Add 0 ingredients' }).style.alignSelf).toBe('stretch');
        expect(screen.queryByRole('button', { name: t.pasteCancel })).toBeNull();
    });

    it('counts live, disabled at 0, and adds what was pasted', () => {
        const submit = vi.fn();
        render(<Host paste={fakePaste({ submit })} />);

        expect(screen.getByRole('button', { name: 'Add 0 ingredients' }).getAttribute('aria-disabled')).toBe('true');
        fireEvent.change(field(), { target: { value: '2 cups flour\n1 tsp salt' } });

        expect(screen.getByText('2 lines')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Add 2 ingredients' }));
        expect(submit).toHaveBeenCalledWith('2 cups flour\n1 tsp salt');
    });

    it('a send that did not take is said as an alert, and the text stays', () => {
        render(<Host paste={fakePaste({ failed: true })} />);
        fireEvent.change(field(), { target: { value: '1 tsp salt' } });

        expect(screen.getByRole('alert').textContent).toBe(t.pasteFailed);
        expect(field().value).toBe('1 tsp salt');
    });
});
