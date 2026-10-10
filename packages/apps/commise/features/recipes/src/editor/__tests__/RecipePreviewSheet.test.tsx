// @vitest-environment jsdom
/**
 * Preview (build spec §7.7 item 4): the real detail page of the draft, in a full-height sheet, under the banner that
 * says it is a preview. Closing returns to the editor.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { previewRecipeOf } from '../previewRecipe.js';
import { RecipePreviewSheet } from '../RecipePreviewSheet.js';

afterEach(cleanup);

const recipe = previewRecipeOf({
    values: makeFilledRecipeFormValues({ title: 'Braised lamb' }),
    recipe: undefined,
    now: '2026-10-09T12:00:00.000Z',
});

describe('RecipePreviewSheet', () => {
    it('shows the draft`s detail page under the preview banner', () => {
        render(
            <LocaleProvider locale="en">
                <CookMarksTestProvider>
                    <RecipePreviewSheet open recipe={recipe} onClose={vi.fn()} />
                </CookMarksTestProvider>
            </LocaleProvider>,
        );

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Preview. This is how it looks to others.')).toBeTruthy();
        expect(within(dialog).getByRole('heading', { level: 1, name: 'Braised lamb' })).toBeTruthy();
    });

    it('closes through its close control', () => {
        const onClose = vi.fn();
        render(
            <LocaleProvider locale="en">
                <CookMarksTestProvider>
                    <RecipePreviewSheet open recipe={recipe} onClose={onClose} />
                </CookMarksTestProvider>
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('renders nothing while closed', () => {
        render(
            <LocaleProvider locale="en">
                <CookMarksTestProvider>
                    <RecipePreviewSheet open={false} recipe={recipe} onClose={vi.fn()} />
                </CookMarksTestProvider>
            </LocaleProvider>,
        );

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
