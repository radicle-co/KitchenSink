// @vitest-environment jsdom
/**
 * Component tests for the web recipe-widget empty state — the default localized copy and a caller-provided
 * override. Mirrors the existing native spec so the empty-state leaf is covered on both platforms.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { recipeMessages } from '../../messages.js';
import { RecipeWidgetEmptyState } from '../RecipeWidgetEmptyState.js';

afterEach(cleanup);

describe('RecipeWidgetEmptyState (web)', () => {
    it('renders the default (en) localized empty-state copy', () => {
        render(<RecipeWidgetEmptyState />);

        // No LocaleProvider → the seam resolves the required default (en) set.
        expect(screen.getByText(recipeMessages.en.emptyState)).toBeTruthy();
    });

    it('renders a caller-provided message', () => {
        render(<RecipeWidgetEmptyState message="Nothing here yet" />);

        expect(screen.getByText('Nothing here yet')).toBeTruthy();
    });
});
