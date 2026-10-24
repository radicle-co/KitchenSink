// @vitest-environment jsdom
/**
 * The recipe widget host refuses to render outside a Home surface, on web as on mobile: without the surface's reporter,
 * a failure inside the slot's boundaries would be dropped silently, the unobserved-failure class B23 closes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeWidgetErrorContext, RecipeWidgetHost } from '../RecipeWidgetHost';

vi.mock('../RecipeWidgetSlot', () => ({
    RecipeWidgetSlot: ({ onWidgetError }: { readonly onWidgetError: (error: unknown) => void }) => (
        <button type="button" onClick={() => onWidgetError(new Error('boom'))}>
            slot
        </button>
    ),
}));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('RecipeWidgetHost', () => {
    it('throws when rendered outside a Home surface, rather than dropping the slot reports', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => render(<RecipeWidgetHost />)).toThrow('RecipeWidgetHost must render inside a HomeWidgetSurface.');
    });

    it('hands the slot the reporter the surface provides', () => {
        const report = vi.fn();

        render(
            <RecipeWidgetErrorContext.Provider value={report}>
                <RecipeWidgetHost />
            </RecipeWidgetErrorContext.Provider>,
        );
        screen.getByRole('button', { name: 'slot' }).click();

        expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    });
});
