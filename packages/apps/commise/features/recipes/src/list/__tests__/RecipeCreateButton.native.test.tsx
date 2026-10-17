/**
 * Native component tests for the create entry (react-native-web under jsdom; build spec §3.4; D4): the floating "New
 * recipe" button opens the editor in one tap. Native has no sidebar, so the floating form is its only form.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeCreateButton } from '../RecipeCreateButton.native.js';

afterEach(cleanup);

describe('RecipeCreateButton (native)', () => {
    it('is ONE button named "New recipe" that opens the editor in one tap, with no menu', () => {
        const onCreateRecipe = vi.fn();
        render(<RecipeCreateButton onCreateRecipe={onCreateRecipe} />);

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByText('Create from Scratch')).toBeNull();
    });

    it('draws its glyph as an icon, never a baseline-positioned "+" character', () => {
        render(<RecipeCreateButton onCreateRecipe={vi.fn()} />);

        expect(within(screen.getByRole('button', { name: 'New recipe' })).queryByText('+')).toBeNull();
    });

    it('is not drawn while the screen shows its first run (§3.4)', () => {
        render(<RecipeCreateButton onCreateRecipe={vi.fn()} firstRun />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });
});
