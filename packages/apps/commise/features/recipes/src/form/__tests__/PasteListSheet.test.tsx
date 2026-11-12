// @vitest-environment jsdom
/**
 * Component tests for the web Paste a list sheet (build spec §7.5.4, §7.10): its title, the labelled field with its
 * hint, the live line count, the primary "Add {n} ingredients" disabled at 0, the refusals before any round trip, and a
 * send that did not take. The sheet's state is the real `usePasteListSheet` over a paste double.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PARSE_JOB_LINE_MAX_CHARS } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorMessages } from '../../editor/messages.js';
import { makePasteIntoIngredients } from '../../__fixtures__/pasteMatching.js';
import type { PasteIntoIngredients } from '../../editor/usePasteIntoIngredients.js';
import { usePasteListSheet } from '../../editor/usePasteListSheet.js';
import { recipeFormMessages } from '../messages.js';
import { PasteListSheet } from '../PasteListSheet.js';

afterEach(cleanup);

const t = editorMessages.en.ingredients;
const form = recipeFormMessages.en;

const fakePaste = (over: Partial<PasteIntoIngredients> = {}): PasteIntoIngredients => makePasteIntoIngredients(over);

const Host: FC<{ readonly paste: PasteIntoIngredients; readonly offersSource?: boolean }> = ({
    paste,
    offersSource = true,
}) => {
    const sheet = usePasteListSheet(paste, {
        initiallyOpen: true,
        copy: { lineTooLong: form.pasteRefusalLineTooLong, tooManyLines: form.pasteRefusalTooManyLines },
    });

    return (
        <PasteListSheet sheet={sheet} submitting={paste.submitting} failed={paste.failed} offersSource={offersSource} />
    );
};

const dialog = (): HTMLElement => screen.getByRole('dialog', { name: t.pasteTitle });
const field = (): HTMLElement => within(dialog()).getByRole('textbox', { name: t.pasteLabel });

const type = (text: string): void => {
    fireEvent.change(field(), { target: { value: text } });
};

const addButton = (name: string): HTMLButtonElement =>
    within(dialog()).getByRole<HTMLButtonElement>('button', { name });
const isDisabled = (button: HTMLButtonElement): boolean =>
    button.disabled || button.getAttribute('aria-disabled') === 'true';

describe('PasteListSheet (web): a link in the paste (ADR-0089)', () => {
    const LINK = 'https://www.allrecipes.com/recipe/1/soup/';

    it('says a link can be pasted too only while the Source can be set', () => {
        const { unmount } = render(<Host paste={fakePaste()} offersSource />);

        expect(within(dialog()).getByText(`${t.pasteHint} ${t.pasteLinkHint}`)).toBeTruthy();

        unmount();
        render(<Host paste={fakePaste()} offersSource={false} />);

        expect(within(dialog()).getByText(t.pasteHint)).toBeTruthy();
        expect(within(dialog()).queryByText(/Paste its link/u)).toBeNull();
    });

    it('a paste that is only a link keeps Add off and says what to do instead', () => {
        render(<Host paste={fakePaste()} />);

        type(LINK);

        expect(isDisabled(addButton('Add 0 ingredients'))).toBe(true);
        expect(within(dialog()).getByText(editorMessages.en.source.linkOnly)).toBeTruthy();
    });

    it('says nothing of the kind for a paste with lines, or for no paste', () => {
        render(<Host paste={fakePaste()} />);

        expect(within(dialog()).queryByText(editorMessages.en.source.linkOnly)).toBeNull();

        type(`2 cups flour\n${LINK}`);

        expect(within(dialog()).queryByText(editorMessages.en.source.linkOnly)).toBeNull();
    });
});

describe('PasteListSheet (web)', () => {
    it('is a sheet titled "Paste a list" with a labelled field described by its hint', () => {
        render(<Host paste={fakePaste()} />);

        const ids = field().getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(ids).toContain(within(dialog()).getByText(`${t.pasteHint} ${t.pasteLinkHint}`).id);
    });

    it('counts the lines live, and the primary adds that many, disabled at 0', () => {
        render(<Host paste={fakePaste()} />);

        expect(isDisabled(addButton('Add 0 ingredients'))).toBe(true);
        expect(within(dialog()).getByText('0 lines')).toBeTruthy();

        type('2 cups flour\n\n1 tsp salt');

        expect(within(dialog()).getByText('2 lines')).toBeTruthy();
        expect(isDisabled(addButton('Add 2 ingredients'))).toBe(false);
    });

    // F11 (`evaluateFinal.md`; `buildSpec.md` §5.1): below 840 the primary fills the sheet and the × is the only way out;
    // at 840+ a ghost Cancel sits beside a content-width primary.
    it('fills the primary and shows Cancel only from 840', () => {
        render(<Host paste={fakePaste()} />);

        const add = addButton('Add 0 ingredients');
        const cancel = within(dialog()).getByRole('button', { name: t.pasteCancel });

        expect(add.className.split(' ')).toContain('w-full');
        expect((cancel.closest('.hidden') as HTMLElement | null)?.className.split(' ')).toContain('nav:block');
    });

    it('adding sends the text to the paste', async () => {
        const user = userEvent.setup();
        const submit = vi.fn();
        render(<Host paste={fakePaste({ submit })} />);
        type('1 tsp salt');

        await user.click(addButton('Add 1 ingredient'));

        expect(submit).toHaveBeenCalledWith('1 tsp salt');
    });

    it('says which line is too long before any round trip, and adds nothing', () => {
        render(<Host paste={fakePaste()} />);

        type(`flour\n${'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1)}`);

        expect(within(dialog()).getByText(/^Line 2 is longer than/u)).toBeTruthy();
        expect(isDisabled(addButton('Add 2 ingredients'))).toBe(true);
    });

    it('a send that did not take is said as an alert, and the text stays', () => {
        render(<Host paste={fakePaste({ failed: true })} />);
        type('1 tsp salt');

        expect(within(dialog()).getByRole('alert').textContent).toBe(t.pasteFailed);
        expect(field()).toHaveProperty('value', '1 tsp salt');
    });

    it('while the job is created the primary reads busy', () => {
        render(<Host paste={fakePaste({ submitting: true })} />);
        type('1 tsp salt');

        expect(addButton('Add 1 ingredient').getAttribute('aria-busy')).toBe('true');
    });
});
