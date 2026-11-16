// @vitest-environment jsdom
/**
 * Component tests for the web `SourceStatementSheet` (ADR-0095): "where is this recipe from?", asked before a pasted recipe
 * goes public. Written from the spec's state table: choosing, answered (each answer), the revealed field, the field error,
 * busy, error, and every dismiss route. The sheet is a pure render of its state, so each case hands it a state.
 *
 * The rows a mutant must not survive: the confirm is refused (not pressable, still focusable) until an answer is chosen; the
 * editor offers five answers and the recipe page four; the revealed field and its error are the answer's own; while busy the
 * list and the dismiss are disabled and Escape is ignored; the effect line is always drawn.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStatementSheet } from '../useStatementSheet.js';
import { initialSheet, type StatementSheetState, type StatementSurface } from '../sourceStatement.js';
import { SourceStatementSheet } from '../SourceStatementSheet.js';

afterEach(cleanup);

function renderSheet(
    over: { readonly surface?: StatementSurface; readonly state?: Partial<StatementSheetState> } = {},
) {
    const handlers = { dispatch: vi.fn(), onConfirm: vi.fn(), onDismiss: vi.fn() };

    render(
        <SourceStatementSheet
            open
            surface={over.surface ?? 'editor'}
            state={{ ...initialSheet(), ...over.state }}
            {...handlers}
        />,
    );

    return handlers;
}

const dialog = () => screen.getByRole('dialog', { name: 'Where is this recipe from?' });

describe('SourceStatementSheet (web) — choosing', () => {
    it('is a dialog named by its title, described by the body and the effect line', () => {
        renderSheet();

        expect(
            screen.getByRole('dialog', {
                name: 'Where is this recipe from?',
                description:
                    /Part of this recipe was pasted in\. Before it goes public, tell us where it’s from\..*If your answer isn’t true/u,
            }),
        ).toBeTruthy();
    });

    it('renders nothing while closed', () => {
        render(
            <SourceStatementSheet
                open={false}
                surface="editor"
                state={initialSheet()}
                dispatch={vi.fn()}
                onConfirm={vi.fn()}
                onDismiss={vi.fn()}
            />,
        );

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers five answers on the editor, in order, none checked, and the radio group is named by the title', () => {
        renderSheet();

        const group = within(dialog()).getByRole('radiogroup', { name: 'Where is this recipe from?' });
        const radios = within(group).getAllByRole('radio');

        expect(radios.map((radio) => radio.textContent)).toEqual([
            expect.stringContaining('I wrote this'),
            expect.stringContaining('From a web page'),
            expect.stringContaining('From a cookbook or magazine'),
            expect.stringContaining('From another person'),
            expect.stringContaining('Publish privately'),
        ]);
        expect(within(group).queryByRole('radio', { checked: true })).toBeNull();
    });

    it('offers four answers on the recipe page, with no way to publish privately', () => {
        renderSheet({ surface: 'recipePage' });

        expect(within(dialog()).getAllByRole('radio')).toHaveLength(4);
        expect(screen.queryByRole('radio', { name: 'Publish privately' })).toBeNull();
    });

    it('draws the confirm as refused, and still focusable, until an answer is chosen', async () => {
        const { onConfirm } = renderSheet();
        const confirm = screen.getByRole('button', { name: 'Publish' });

        expect(confirm.getAttribute('aria-disabled')).toBe('true');
        confirm.focus();
        expect(document.activeElement).toBe(confirm);
        await userEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('says what the answer does in the footer, before the confirm', () => {
        renderSheet();

        expect(
            screen.getByText('If your answer isn’t true, we can remove the recipe and limit your account.'),
        ).toBeTruthy();
    });

    it('names the editor’s buttons Keep as draft and Publish, and the recipe page’s Cancel and Make public', () => {
        renderSheet();
        expect(screen.getByRole('button', { name: 'Keep as draft' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();

        cleanup();
        renderSheet({ surface: 'recipePage' });
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Make public' })).toBeTruthy();
    });

    it('reports a picked answer', async () => {
        const { dispatch } = renderSheet();

        await userEvent.click(screen.getByRole('radio', { name: 'From a web page' }));

        expect(dispatch).toHaveBeenCalledWith({ type: 'choose', answer: 'publicWeb' });
    });
});

describe('SourceStatementSheet (web) — answered', () => {
    it.each([
        ['authored', 'I wrote this'],
        ['publicWeb', 'From a web page'],
        ['book', 'From a cookbook or magazine'],
        ['fromPerson', 'From another person'],
        ['publishPrivately', 'Publish privately'],
    ] as const)('checks %s, enables the confirm, and confirming reports it', async (answer, name) => {
        const { onConfirm } = renderSheet({ state: { answer, link: 'https://example.com/r', bookTitle: 'Joy' } });

        expect(screen.getByRole('radio', { name, checked: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('aria-disabled')).not.toBe('true');
        await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('describes "I wrote this" by its hint, and every other answer by the private hint', () => {
        renderSheet();

        expect(
            screen.getByRole('radio', {
                name: 'I wrote this',
                description:
                    'It’s my own recipe, in my own words, and any photos are mine. It isn’t copied from a website, book or another person. Goes public.',
            }),
        ).toBeTruthy();
        expect(
            screen.getByRole('radio', { name: 'From a web page', description: 'Stays private to you.' }),
        ).toBeTruthy();
        expect(
            screen.getByRole('radio', {
                name: 'From another person',
                description: 'A recipe someone gave you, like family or a friend. Stays private to you.',
            }),
        ).toBeTruthy();
        // The editor's own fifth answer says what it is in its label alone.
        expect(screen.getByRole('radio', { name: 'Publish privately', description: '' })).toBeTruthy();
    });

    it('reveals the link field for a web page only, reporting what is typed', async () => {
        const { dispatch } = renderSheet({ state: { answer: 'publicWeb' } });

        expect(screen.queryByLabelText('Book or magazine title')).toBeNull();
        await userEvent.type(screen.getByLabelText('Source'), 'h');
        expect(dispatch).toHaveBeenCalledWith({ type: 'link', text: 'h' });
    });

    it('reveals the title field for a cookbook only', async () => {
        const { dispatch } = renderSheet({ state: { answer: 'book' } });

        expect(screen.queryByLabelText('Source')).toBeNull();
        await userEvent.type(screen.getByLabelText('Book or magazine title'), 'J');
        expect(dispatch).toHaveBeenCalledWith({ type: 'bookTitle', text: 'J' });
    });

    it('reveals no field for the other answers', () => {
        renderSheet({ state: { answer: 'authored' } });

        expect(screen.queryByRole('textbox')).toBeNull();
    });
});

describe('SourceStatementSheet (web) — field error', () => {
    it('shows the book title error on the field: invalid, described by the error, and taking focus', () => {
        // A Confirm just failed, so the state carries the pending focus request (`focusPending`).
        renderSheet({ state: { answer: 'book', attempted: true, focusPending: true } });

        const field = screen.getByLabelText('Book or magazine title');

        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText('Add the book or magazine title.')).toBeTruthy();
        expect(document.activeElement).toBe(field);
        expect(field.getAttribute('aria-describedby')).toContain(
            screen.getByText('Add the book or magazine title.').id,
        );
    });

    it.each([
        ['', 'That isn’t a web link. Paste the page address, like https://example.com/recipe.'],
        ['soup', 'That isn’t a web link. Paste the page address, like https://example.com/recipe.'],
        ['https://commise.app/recipes/1', 'That’s a Commise link. Paste the link of the page you copied from.'],
    ])('says why the link %j cannot be used', (link, message) => {
        renderSheet({ state: { answer: 'publicWeb', attempted: true, link } });

        expect(screen.getByText(message)).toBeTruthy();
        expect(screen.getByLabelText('Source').getAttribute('aria-invalid')).toBe('true');
    });

    it('shows no error before Confirm was pressed', () => {
        renderSheet({ state: { answer: 'book' } });

        expect(screen.queryByText('Add the book or magazine title.')).toBeNull();
    });
});

describe('SourceStatementSheet (web) — busy and error', () => {
    it('busy: the confirm is busy, the list and the dismiss are disabled, and the status is said', () => {
        renderSheet({ surface: 'recipePage', state: { answer: 'authored', status: 'busy' } });

        expect(screen.getByRole('button', { name: 'Make public' }).getAttribute('aria-busy')).toBe('true');
        expect(
            within(dialog())
                .getAllByRole('radio')
                .every((radio) => (radio as HTMLButtonElement).disabled),
        ).toBe(true);
        expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('busy: Escape, the Close control and the dismiss do not dismiss it', async () => {
        const { onDismiss } = renderSheet({ surface: 'recipePage', state: { answer: 'authored', status: 'busy' } });

        fireEvent.keyDown(dialog(), { key: 'Escape' });
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('error: an alert above the footer, the confirm retries, and Close dismisses', async () => {
        const { onConfirm, onDismiss } = renderSheet({
            surface: 'recipePage',
            state: { answer: 'authored', status: 'failed' },
        });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t change who can see this recipe. Try again.');
        await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});

describe('SourceStatementSheet (web) — dismiss', () => {
    it('Keep as draft dismisses, and sends nothing', async () => {
        const { onConfirm, onDismiss } = renderSheet();

        await userEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Escape and the Close control dismiss too, as one route', async () => {
        const { onDismiss } = renderSheet();

        fireEvent.keyDown(dialog(), { key: 'Escape' });
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onDismiss).toHaveBeenCalledTimes(2);
    });

    it('Cancel dismisses on the recipe page', async () => {
        const { onDismiss } = renderSheet({ surface: 'recipePage' });

        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});

describe('SourceStatementSheet (web) — focus on a failed Confirm', () => {
    /** The sheet wired to its real state, as a host wires it. */
    function Hosted() {
        const sheet = useStatementSheet({ locale: 'en', onAnswer: vi.fn() });

        return (
            <SourceStatementSheet
                open
                surface="editor"
                state={sheet.state}
                dispatch={sheet.dispatch}
                onConfirm={sheet.confirm}
                onDismiss={vi.fn()}
            />
        );
    }

    it('moves focus back to the field on every failed Confirm, not only the first', async () => {
        const user = userEvent.setup();

        render(<Hosted />);
        await user.click(screen.getByRole('radio', { name: /From a cookbook or magazine/u }));

        const field = screen.getByLabelText('Book or magazine title');
        const confirm = screen.getByRole('button', { name: 'Publish' });

        await user.click(confirm);
        expect(document.activeElement).toBe(field);

        await user.click(confirm);
        expect(document.activeElement).toBe(field);
    });
});
