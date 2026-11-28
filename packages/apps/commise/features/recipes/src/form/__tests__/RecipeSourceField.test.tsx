// @vitest-environment jsdom
/**
 * Component tests for the web Source row in Photos & publish (ADR-0089): the web page a recipe was copied from. A pure
 * render of `SourceRowModel`, so each case is one state of the editor spec's table: empty, filled (typed, and from a paste),
 * invalid, a Commise link, locked after publishing, and hidden. The words are `editorMessages.source`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SOURCE_LINK_INPUT_MAX_LENGTH, SOURCE_LINK_MAX_LENGTH } from '@kitchensink/recipe-core';

import { recipeActionMessages } from '../../actions/messages.js';
import { editorMessages } from '../../editor/messages.js';
import type { SourceRowModel } from '../sourceLink.js';
import { RecipeSourceField } from '../RecipeSourceField.js';
import { sourceErrorId } from '../fieldErrorIds.js';

const m = editorMessages.en.source;
const a = recipeActionMessages.en.sourceStatement;
const URL = 'https://www.allrecipes.com/recipe/1/soup/';

afterEach(cleanup);

function renderRow(row: SourceRowModel, over: Partial<Parameters<typeof RecipeSourceField>[0]> = {}) {
    const handlers = { onChange: vi.fn(), onRemove: vi.fn(), onTouched: vi.fn(), onAsk: vi.fn() };

    render(<RecipeSourceField row={row} {...handlers} {...over} />);

    return handlers;
}

const field = () => screen.getByRole<HTMLInputElement>('textbox', { name: m.label });
const describedBy = (el: HTMLElement) =>
    (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);

describe('RecipeSourceField (web)', () => {
    it('empty: a labelled URL field with the hint, and no Remove', () => {
        renderRow({ kind: 'empty', text: '' });

        expect(field().value).toBe('');
        expect(field().getAttribute('inputmode')).toBe('url');
        expect(field().getAttribute('autocapitalize')).toBe('none');
        expect(field().getAttribute('autocorrect')).toBe('off');
        expect(describedBy(field())).toContain(m.hint);
        expect(screen.queryByRole('button', { name: m.remove })).toBeNull();
    });

    // The reader refuses an address past the cap unread, so the field stops a hostile paste from freezing the page.
    it('caps how much text the field takes, a little over the longest source link', () => {
        renderRow({ kind: 'empty', text: '' });

        expect(field().maxLength).toBe(SOURCE_LINK_INPUT_MAX_LENGTH);
        expect(SOURCE_LINK_INPUT_MAX_LENGTH).toBeGreaterThan(SOURCE_LINK_MAX_LENGTH);
    });

    it('typing reports the text', async () => {
        const { onChange } = renderRow({ kind: 'empty', text: '' });

        fireEvent.change(field(), { target: { value: URL } });

        expect(onChange).toHaveBeenCalledWith(URL);
    });

    it('filled: says it is copied from a public web page and which site, and offers Remove', async () => {
        const user = userEvent.setup();
        const { onRemove } = renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false });

        expect(field().value).toBe(URL);
        expect(describedBy(field())).toContain('Copied from a public web page · allrecipes.com');
        expect(field().getAttribute('aria-invalid')).not.toBe('true');

        await user.click(screen.getByRole('button', { name: m.remove }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('filled from a paste: says it was added from the paste', () => {
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: true });

        expect(screen.getByText(m.fromPaste)).toBeTruthy();
        expect(describedBy(field())).toContain(m.fromPaste);
    });

    it('not from a paste: says nothing about one', () => {
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false });

        expect(screen.queryByText(m.fromPaste)).toBeNull();
    });

    it('invalid: an error tied to the field, and Remove to clear it', () => {
        renderRow({ kind: 'invalid', text: 'soup' });

        expect(field().getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText(m.invalid).id).toBe(sourceErrorId);
        expect(describedBy(field())).toContain(m.invalid);
        expect(screen.getByRole('button', { name: m.remove })).toBeTruthy();
    });

    it('a Commise link: its own error', () => {
        renderRow({ kind: 'ownSite', text: 'https://commise.app/en' });

        expect(field().getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText(m.ownSite)).toBeTruthy();
        expect(screen.queryByText(m.invalid)).toBeNull();
    });

    it('locked: the site as a link that opens in a new tab, the address, the reason, and no field and no Remove', () => {
        renderRow({ kind: 'locked', site: 'allrecipes.com', url: URL });

        const link = screen.getByRole('link', { name: 'allrecipes.com (opens in a new tab)' });

        expect(link.getAttribute('href')).toBe(URL);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
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

    it('after a downgrade the answer takes focus, which the closed sheet left nowhere (SC 2.4.3)', () => {
        const row: SourceRowModel = { kind: 'lockedAnswer', answer: 'book', citation: 'Joy' };
        const handlers = { onChange: vi.fn(), onRemove: vi.fn(), onTouched: vi.fn(), onAsk: vi.fn() };
        const { rerender } = render(<RecipeSourceField row={row} {...handlers} focusSignal={0} />);

        expect(document.activeElement).toBe(document.body);
        rerender(<RecipeSourceField row={row} {...handlers} focusSignal={1} />);

        expect(document.activeElement?.textContent).toBe(a.answerBook);
    });

    it('hidden: nothing at all', () => {
        const { container } = render(
            <RecipeSourceField
                row={{ kind: 'hidden' }}
                onAsk={vi.fn()}
                onTouched={vi.fn()}
                onChange={vi.fn()}
                onRemove={vi.fn()}
            />,
        );

        expect(container.textContent).toBe('');
    });

    it('half-typed text is not an error yet, and can already be cleared', () => {
        renderRow({ kind: 'empty', text: 'https://exa' });

        expect(field().getAttribute('aria-invalid')).not.toBe('true');
        expect(screen.queryByText(m.invalid)).toBeNull();
        expect(screen.getByRole('button', { name: m.remove })).toBeTruthy();
    });

    it('leaving the field says the cook is done typing', () => {
        const { onTouched } = renderRow({ kind: 'empty', text: 'https://exa' });

        fireEvent.blur(field());

        expect(onTouched).toHaveBeenCalledTimes(1);
    });

    // REWRITTEN for the designer's approval fixes: this said a Remove asks the field for focus. The row never takes focus on its own
    // now (the keyboard rose over the held note); the editor moves focus to "Who can see it" (`RecipeEditorSurface.test.tsx`).
    it('the emptied field takes no focus of its own, so no keyboard is raised by a Remove', () => {
        renderRow({ kind: 'empty', text: '' });

        expect(document.activeElement).not.toBe(field());
    });
});

const HELP = 'https://commise.app/support?recipe=r1';

describe('RecipeSourceField (web): the row after the lock (ADR-0100)', () => {
    it.each([
        ['a locked web page', { kind: 'locked', site: 'allrecipes.com', url: URL }],
        ['a locked book', { kind: 'lockedAnswer', answer: 'book', citation: 'The Sunday Roast Book' }],
        ['a locked paid site', { kind: 'lockedAnswer', answer: 'paidSite', citation: 'Sam’s Kitchen' }],
        ['another person', { kind: 'lockedAnswer', answer: 'fromPerson' }],
        ['an answer this app cannot word', { kind: 'lockedAnswer' }],
    ] as const)('%s: says who can change it and links to ask, in a new tab', (_name, row) => {
        renderRow(row, { askHref: HELP });

        const link = screen.getByRole('link', { name: m.askChangeWeb });

        expect(link.getAttribute('href')).toBe(HELP);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
        expect(screen.getByText(m.locked)).toBeTruthy();
    });

    it.each([
        { kind: 'locked', site: 'allrecipes.com', url: URL },
        { kind: 'lockedAnswer', answer: 'book', citation: '' },
    ] as const)(
        'draws no help link when no support address is set, and the locked line still reads true (%j)',
        (row) => {
            renderRow(row);

            expect(screen.queryByRole('link', { name: m.askChangeWeb })).toBeNull();
            expect(screen.getByText(m.locked)).toBeTruthy();
        },
    );

    it('a locked book names the answer and its title; an empty title draws no empty line', () => {
        renderRow({ kind: 'lockedAnswer', answer: 'book', citation: 'The Sunday Roast Book' });
        expect(screen.getByText(a.answerBook)).toBeTruthy();
        expect(screen.getByText('The Sunday Roast Book')).toBeTruthy();
        cleanup();

        const { container } = render(
            <RecipeSourceField
                row={{ kind: 'lockedAnswer', answer: 'book', citation: '' }}
                {...{ onChange: vi.fn(), onRemove: vi.fn(), onTouched: vi.fn(), onAsk: vi.fn() }}
            />,
        );

        expect(container.querySelectorAll('span.text-caption')).toHaveLength(0);
    });

    it('own: the answer and one button to change it, with no locked line (the downgrade is open)', async () => {
        const { onAsk } = renderRow({ kind: 'own' }, { askHref: HELP });

        expect(screen.getByText(a.answerAuthored)).toBeTruthy();
        expect(screen.queryByText(m.locked)).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: m.changeOwn }));
        expect(onAsk).toHaveBeenCalledWith('downgrade');
        expect(screen.getByRole('link', { name: m.askOtherWeb }).getAttribute('href')).toBe(HELP);
        expect(screen.queryByRole('link', { name: m.askChangeWeb })).toBeNull();
    });

    it('own with no support address: the button, and no link', () => {
        renderRow({ kind: 'own' });

        expect(screen.getByRole('button', { name: m.changeOwn })).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('open, answered: the stored book, its title, the warning, and the control that changes the answer', async () => {
        const { onAsk } = renderRow({ kind: 'openAnswered', answer: 'book', citation: 'The Sunday Roast Book' });

        expect(screen.getByText(a.answerBook)).toBeTruthy();
        expect(screen.getByText('The Sunday Roast Book')).toBeTruthy();
        expect(screen.getByText(m.lockWarning)).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: m.changeAnswer }));
        expect(onAsk).toHaveBeenCalledWith('change');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('open, none: the field with no warning, and the button that says where it is from', async () => {
        const { onAsk } = renderRow({ kind: 'empty', text: '' }, { askHref: HELP });

        expect(screen.queryByText(m.lockWarning)).toBeNull();
        expect(screen.queryByText(m.lockWarningSave)).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: m.sayWhere }));
        expect(onAsk).toHaveBeenCalledWith('firstAnswer');
        // Never a help link on a row nothing has locked.
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('a filled link warns that publishing locks it, and the field is described by the warning', () => {
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false });

        expect(screen.getByText(m.lockWarning)).toBeTruthy();
        expect(screen.queryByText(m.lockWarningSave)).toBeNull();
        expect(describedBy(field())).toContain(m.lockWarning);
    });

    it('a filled link on a confirmed recipe warns that saving locks it', () => {
        renderRow({ kind: 'filled', text: URL, site: 'allrecipes.com', fromPaste: false, confirmed: true });

        expect(screen.getByText(m.lockWarningSave)).toBeTruthy();
        expect(screen.queryByText(m.lockWarning)).toBeNull();
        expect(describedBy(field())).toContain(m.lockWarningSave);
    });
});
