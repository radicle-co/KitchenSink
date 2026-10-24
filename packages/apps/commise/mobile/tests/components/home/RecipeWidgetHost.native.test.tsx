/**
 * The recipe widget host refuses to render outside a Home surface: the slot's navigation intents are required, so there
 * is no inert default to fall back on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { RecipeWidgetHost } from '../../../src/components/home/RecipeWidgetHost.js';

vi.mock('../../../src/components/home/RecipeWidgetSlot.js', () => ({ RecipeWidgetSlot: () => null }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('RecipeWidgetHost (mobile)', () => {
    it('throws when rendered outside a Home surface', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => render(<RecipeWidgetHost />)).toThrow('RecipeWidgetHost must render inside a HomeWidgetSurface.');
    });
});
