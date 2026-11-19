/**
 * The native scale note: the sentence that tells the cook the steps give amounts for another serving count, and the one
 * quiet button that opens the ingredients. Nothing is mocked. The button is drawn only when the screen hands over
 * `onOpen`, and it is named by `openLabel`, so a note with no way to open anything never shows a dead control.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingScaleNote } from '../CookingScaleNote.native.js';

const user = userEvent.setup({ delay: null });
const NOTE = 'The steps give amounts for 4. You’re making 8, so use the amounts in Ingredients.';

afterEach(cleanup);

describe('CookingScaleNote (native)', () => {
    it('says the note once, as text, with no heading', () => {
        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" onOpen={vi.fn()} />);

        expect(screen.getAllByText(NOTE)).toHaveLength(1);
        expect(screen.queryAllByRole('heading')).toHaveLength(0);
    });

    it('draws one button named by openLabel, and calls onOpen once when it is pressed', async () => {
        const onOpen = vi.fn();

        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" onOpen={onOpen} />);

        expect(screen.getAllByRole('button')).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Open ingredients' }));

        expect(onOpen).toHaveBeenCalledExactlyOnceWith();
    });

    it('draws the note and no button while onOpen is absent', () => {
        render(<CookingScaleNote note={NOTE} openLabel="Open ingredients" />);

        expect(screen.getByText(NOTE)).toBeTruthy();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
});
