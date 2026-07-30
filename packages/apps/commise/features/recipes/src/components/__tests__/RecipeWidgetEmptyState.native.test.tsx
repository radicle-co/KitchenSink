import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeWidgetEmptyState } from '../RecipeWidgetEmptyState.native.js';

afterEach(cleanup);

describe('RecipeWidgetEmptyState (native)', () => {
    it('renders the default empty-state copy', () => {
        render(<RecipeWidgetEmptyState />);

        expect(screen.getByText(/No recipes yet/i)).toBeTruthy();
    });

    it('renders a caller-provided message', () => {
        render(<RecipeWidgetEmptyState message="Nothing here yet" />);

        expect(screen.getByText('Nothing here yet')).toBeTruthy();
    });
});
