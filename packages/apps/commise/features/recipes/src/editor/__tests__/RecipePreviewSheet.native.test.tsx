/**
 * The native Preview (build spec §7.7 item 4, A-012): the real detail page of the draft, full screen, under a banner
 * that says it is a preview. The banner is a tinted `surfaceMuted` block with the `md` radius, as on web
 * (`RecipePreviewSheet.tsx`), not bare text beside the close control.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { themeFor } from '@commise/ui/theme';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { cssColor } from '../../__tests__/cssColor.js';
import { previewRecipeOf } from '../previewRecipe.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipePreviewSheet } from '../RecipePreviewSheet.native.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(cleanup);

const recipe = previewRecipeOf({
    values: makeFilledRecipeFormValues({ title: 'Braised lamb' }),
    recipe: undefined,
    now: '2026-10-09T12:00:00.000Z',
});

const BANNER = 'Preview. This is how it looks to others.';

function renderPreview(over: { readonly open?: boolean; readonly onClose?: () => void } = {}): void {
    render(
        <LocaleProvider locale="en">
            <CookMarksTestProvider>
                <RecipePreviewSheet open={over.open ?? true} recipe={recipe} onClose={over.onClose ?? vi.fn()} />
            </CookMarksTestProvider>
        </LocaleProvider>,
    );
}

describe('RecipePreviewSheet (native)', () => {
    it('shows the draft`s detail page under the preview banner', () => {
        renderPreview();

        expect(screen.getByText(BANNER)).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Braised lamb' })).toBeTruthy();
    });

    it('draws the banner in a tinted surfaceMuted block with the md radius, not as bare text', () => {
        renderPreview();

        const block = screen.getByText(BANNER).parentElement as HTMLElement;
        const style = getComputedStyle(block);

        expect(style.backgroundColor).toBe(cssColor(themeFor('light').colors.surfaceMuted));

        // react-native-web compiles `borderRadius` to the four corner longhands, which jsdom does not fold back.
        for (const corner of [
            'borderTopLeftRadius',
            'borderTopRightRadius',
            'borderBottomLeftRadius',
            'borderBottomRightRadius',
        ] as const) {
            expect(style[corner]).toBe(`${nativeTokens.radius.md}px`);
        }
    });

    it('keeps the close control outside the tinted block, so the block is the banner and nothing else', () => {
        renderPreview();

        const block = screen.getByText(BANNER).parentElement as HTMLElement;

        expect(within(block).queryByRole('button')).toBeNull();
        expect(screen.getByRole('button', { name: 'Close preview' })).toBeTruthy();
    });

    it('closes through its close control', () => {
        const onClose = vi.fn();

        renderPreview({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders nothing while closed', () => {
        renderPreview({ open: false });

        expect(screen.queryByText(BANNER)).toBeNull();
    });
});
