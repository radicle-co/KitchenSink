/**
 * The recipe widget host refuses to render outside a Home surface: the slot's navigation intents are required, so there
 * is no inert default to fall back on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { RecipeWidgetHost } from '../../../src/components/home/RecipeWidgetHost.js';
import { render } from '@commise/ui/testing/tamagui';

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
