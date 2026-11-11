// @vitest-environment jsdom
/**
 * Component tests for the web Source row in Photos & publish (ADR-0089): the web page a recipe was copied from. A pure
 * render of `SourceRowModel`, so each case is one state of the editor spec's table: empty, filled (typed, and from a paste),
 * invalid, a Commise link, locked after publishing, and hidden. The words are `editorMessages.source`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorMessages } from '../../editor/messages.js';
import type { SourceRowModel } from '../sourceLink.js';
import { RecipeSourceField } from '../RecipeSourceField.js';
import { sourceErrorId } from '../fieldErrorIds.js';

const m = editorMessages.en.source;
const URL = 'https://www.allrecipes.com/recipe/1/soup/';

afterEach(cleanup);

function renderRow(row: SourceRowModel, over: Partial<Parameters<typeof RecipeSourceField>[0]> = {}) {
    const handlers = { onChange: vi.fn(), onRemove: vi.fn(), onFocusHandled: vi.fn(), onTouched: vi.fn() };

    render(<RecipeSourceField row={row} focusRequested={false} {...handlers} {...over} />);

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

    it('hidden: nothing at all', () => {
        const { container } = render(
            <RecipeSourceField
                row={{ kind: 'hidden' }}
                focusRequested={false}
                onTouched={vi.fn()}
                onChange={vi.fn()}
                onRemove={vi.fn()}
                onFocusHandled={vi.fn()}
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

    it('a Remove asks the field for focus, and says when it took it', () => {
        const { onFocusHandled } = renderRow({ kind: 'empty', text: '' }, { focusRequested: true });

        expect(document.activeElement).toBe(field());
        expect(onFocusHandled).toHaveBeenCalledTimes(1);
    });
});
