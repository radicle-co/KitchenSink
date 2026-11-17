/**
 * Component tests for the native `SourceStatementSheet` (ADR-0095), rendered through react-native-web: the same states and
 * words as the web leaf, from the same view model. Choosing, answered (each answer), the revealed field, the field error,
 * busy, error, and every dismiss route.
 *
 * The rows a mutant must not survive: the confirm is refused until an answer is chosen; the editor offers five answers and
 * the recipe page four; the field and its error are the answer's own; busy disables the list and ignores the platform back
 * route; the effect line is always drawn in the footer.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { initialSheet, type StatementSheetState, type StatementSurface } from '../sourceStatement.js';
import { SourceStatementSheet } from '../SourceStatementSheet.native.js';
import { render } from '@commise/ui/testing/tamagui';

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

describe('SourceStatementSheet (native) — choosing', () => {
    it('is a dialog titled "Where is this recipe from?" with the body and the effect line drawn', () => {
        renderSheet();

        expect(
            screen.getByRole('heading', { name: 'Where is this recipe from?' }).closest('[role="dialog"]'),
        ).toBeTruthy();
        expect(
            screen.getByText('Part of this recipe was pasted in. Before it goes public, tell us where it’s from.'),
        ).toBeTruthy();
        expect(
            screen.getByText('If your answer isn’t true, we can remove the recipe and limit your account.'),
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

        expect(screen.queryByRole('heading', { name: 'Where is this recipe from?' })).toBeNull();
    });

    it('offers five answers on the editor, in order, none checked, in a radio group named by the title', () => {
        renderSheet();

        const group = screen.getByRole('radiogroup', { name: 'Where is this recipe from?' });
        const radios = within(group).getAllByRole('radio');

        expect(radios.map((radio) => radio.textContent)).toEqual([
            expect.stringContaining('I wrote this'),
            expect.stringContaining('From a web page'),
            expect.stringContaining('From a cookbook or magazine'),
            expect.stringContaining('From another person'),
            expect.stringContaining('Publish privately'),
        ]);
        expect(radios.some((radio) => radio.getAttribute('aria-checked') === 'true')).toBe(false);
    });

    it('offers four answers on the recipe page, with no way to publish privately', () => {
        renderSheet({ surface: 'recipePage' });

        expect(screen.getAllByRole('radio')).toHaveLength(4);
        expect(screen.queryByRole('radio', { name: 'Publish privately' })).toBeNull();
    });

    it('draws the confirm as refused until an answer is chosen, and a press does nothing', () => {
        const { onConfirm } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(onConfirm).not.toHaveBeenCalled();
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

    it('reports a picked answer', () => {
        const { dispatch } = renderSheet();

        fireEvent.click(screen.getByRole('radio', { name: 'From a web page' }));

        expect(dispatch).toHaveBeenCalledWith({ type: 'choose', answer: 'publicWeb' });
    });
});

describe('SourceStatementSheet (native) — answered', () => {
    it.each([
        ['authored', 'I wrote this'],
        ['publicWeb', 'From a web page'],
        ['book', 'From a cookbook or magazine'],
        ['fromPerson', 'From another person'],
        ['publishPrivately', 'Publish privately'],
    ] as const)('checks %s, and confirming reports it', (answer, name) => {
        const { onConfirm } = renderSheet({ state: { answer, link: 'https://example.com/r', bookTitle: 'Joy' } });

        expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('reveals the link field for a web page, and the title field for a cookbook, and none otherwise', () => {
        renderSheet({ state: { answer: 'publicWeb' } });
        expect(screen.getByLabelText('Link to the page')).toBeTruthy();
        expect(screen.queryByLabelText('Book or magazine title')).toBeNull();

        cleanup();
        renderSheet({ state: { answer: 'book' } });
        expect(screen.getByLabelText('Book or magazine title')).toBeTruthy();
        expect(screen.queryByLabelText('Link to the page')).toBeNull();

        cleanup();
        renderSheet({ state: { answer: 'authored' } });
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('reports what is typed in the revealed field', () => {
        const { dispatch } = renderSheet({ state: { answer: 'book' } });

        fireEvent.change(screen.getByLabelText('Book or magazine title'), { target: { value: 'J' } });

        expect(dispatch).toHaveBeenCalledWith({ type: 'bookTitle', text: 'J' });
    });
});

describe('SourceStatementSheet (native) — field error', () => {
    it('shows the book title error under the field', () => {
        renderSheet({ state: { answer: 'book', attempted: true } });

        expect(screen.getByText('Add the book or magazine title.')).toBeTruthy();
        expect(screen.getByLabelText('Book or magazine title')).toBeTruthy();
    });

    it('shows no error before Confirm was pressed', () => {
        renderSheet({ state: { answer: 'book' } });

        expect(screen.queryByText('Add the book or magazine title.')).toBeNull();
    });

    it('says why a link cannot be used', () => {
        renderSheet({ state: { answer: 'publicWeb', attempted: true, link: 'soup' } });

        expect(
            screen.getByText('That isn’t a web link. Paste the page address, like https://example.com/recipe.'),
        ).toBeTruthy();
    });
});

describe('SourceStatementSheet (native) — busy and error', () => {
    it('busy: the list is disabled and the platform back route does not dismiss it', () => {
        const { onDismiss } = renderSheet({ surface: 'recipePage', state: { answer: 'authored', status: 'busy' } });

        expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-disabled') === 'true')).toBe(
            true,
        );
        fireEvent.keyUp(document, { key: 'Escape' });
        expect(onDismiss).not.toHaveBeenCalled();
    });

    // The designer's approval fixes: the sheet itself says it is busy, so a screen reader hears that the whole question is waiting.
    it('busy: the sheet is busy to a screen reader, and it is not while the cook is answering', () => {
        renderSheet({ surface: 'recipePage', state: { answer: 'authored', status: 'busy' } });
        // The window's own dialog wraps the sheet's, so the sheet's is the nearest one around its title.
        const sheet = (): HTMLElement | null =>
            screen.getByRole('heading', { name: 'Where is this recipe from?' }).closest('[role="dialog"]');

        expect(sheet()?.getAttribute('aria-busy')).toBe('true');

        cleanup();
        renderSheet({ surface: 'recipePage', state: { answer: 'authored' } });
        expect(sheet()?.getAttribute('aria-busy')).not.toBe('true');
    });

    it('error: an alert in the sheet, and the confirm retries', () => {
        const { onConfirm } = renderSheet({ surface: 'recipePage', state: { answer: 'authored', status: 'failed' } });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t change who can see this recipe. Try again.');
        fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

describe('SourceStatementSheet (native) — dismiss', () => {
    it('Keep as draft dismisses, and sends nothing', () => {
        const { onConfirm, onDismiss } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('the platform back route and the Close control dismiss as one route', () => {
        const { onDismiss } = renderSheet();

        fireEvent.keyUp(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onDismiss).toHaveBeenCalledTimes(2);
    });

    it('Cancel dismisses on the recipe page', () => {
        const { onDismiss } = renderSheet({ surface: 'recipePage' });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});

// On a phone the keyboard and the pinned footer leave the field's last line at the foot of a short scroll region, so a message
// BELOW the field was not on screen (Android Maestro: "Add the book or magazine title." was not visible). The sheet has no
// field reveal host to carry the message with the field, so the message is said between the label and the field.
describe('SourceStatementSheet (native) — the field message is said above the field', () => {
    it.each([
        ['book', 'Book or magazine title', 'Add the book or magazine title.'],
        [
            'publicWeb',
            'Link to the page',
            'That isn’t a web link. Paste the page address, like https://example.com/recipe.',
        ],
    ] as const)(
        'says the %s field error before the field, where the keyboard cannot hide it',
        (answer, label, message) => {
            renderSheet({ state: { answer, attempted: true } });

            const error = screen.getByText(message);
            const field = screen.getByLabelText(label);

            expect(error.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        },
    );
});

// A screen reader says a field error as it appears (review item 11): the house `Input` carries it as the field's hint, which is read
// on reaching the field, and the sheet's own message above the field is an assertive live region, which is what Android reads
// at once and what iOS is handed as an announcement. `role="alert"` is how the live region shows on this tier.
describe('SourceStatementSheet (native) — the field error is announced', () => {
    it.each([
        ['book', 'Add the book or magazine title.'],
        ['publicWeb', 'That isn’t a web link. Paste the page address, like https://example.com/recipe.'],
    ] as const)('the %s error is an alert carrying the message', (answer, message) => {
        renderSheet({ state: { answer, attempted: true } });

        expect(screen.getByRole('alert').textContent).toBe(message);
    });

    it('says nothing before Confirm was pressed', () => {
        renderSheet({ state: { answer: 'book' } });

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
