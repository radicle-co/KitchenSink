/**
 * The web scale note: the sentence that tells the cook the steps give amounts for another serving count, and the one
 * quiet button that opens the ingredients. Nothing is mocked. The button is drawn only when the screen hands over
 * `onOpen`, and it is named by `openLabel`, so a note with no way to open anything never shows a dead control. It is
 * the web twin of the native note: the same props, the same cases.
 */
import { buttonSurfaceClass } from '@commise/ui/button';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingScaleNote } from '../CookingScaleNote.js';

const user = userEvent.setup({ delay: null });
const NOTE = 'The steps give amounts for 4. You’re making 8, so use the amounts in Ingredients.';

afterEach(cleanup);

describe('CookingScaleNote (web)', () => {
    it('says the note once, as text, with no heading', () => {
        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" onOpen={vi.fn()} />);

        expect(screen.getAllByText(NOTE)).toHaveLength(1);
        expect(screen.queryAllByRole('heading')).toHaveLength(0);
    });

    it('draws one button named by openLabel, and calls onOpen once when it is pressed', async () => {
        const onOpen = vi.fn();

        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" onOpen={onOpen} />);

        expect(screen.getAllByRole('button')).toHaveLength(1);

        const button = screen.getByRole('button', { name: 'Open ingredients' });

        // The house check: the class is the quiet variant at the default (md) size, so a primary or sm button fails.
        expect(button.className).toBe(buttonSurfaceClass('quiet'));

        await user.click(button);

        expect(onOpen).toHaveBeenCalledExactlyOnceWith();
    });

    it('draws the note and no button while onOpen is absent', () => {
        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" />);

        expect(screen.getByText(NOTE)).toBeTruthy();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('is a note, with a hidden glyph before a muted meta sentence, so it does not read as part of the step', () => {
        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" onOpen={vi.fn()} />);

        const note = screen.getByRole('note');
        const sentence = screen.getByText(NOTE);
        const glyph = note.querySelector('svg');

        expect(note.contains(sentence)).toBe(true);

        if (glyph === null) {
            throw new Error('the note draws no glyph');
        }

        expect(glyph.getAttribute('aria-hidden')).toBe('true');
        expect(glyph.compareDocumentPosition(sentence)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(glyph.style.color).toBe('var(--color-ink-muted)');
        expect(note.className.split(' ')).toContain('items-start');
        expect(sentence.className).toContain('text-meta');
        expect(sentence.className).toContain('text-ink-muted');
    });
});
