/**
 * Native component tests for `RecipeVisibilityStatement.native` (plan 2026-10-14-009 D14), rendered through
 * react-native-web under jsdom. Mirrors `RecipeVisibilityStatement.test.tsx`: the statement the editor shows in place
 * of the visibility field when Private is not offered, read as ONE element by a screen reader.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { editorMessages } from '../../editor/messages.js';
import { recipeFormMessages } from '../messages.js';
import { RecipeVisibilityStatement } from '../RecipeVisibilityStatement.native.js';

const v = editorMessages.en.visibility;

afterEach(cleanup);

describe('RecipeVisibilityStatement (native)', () => {
    it('is read as one element: "Who can see it: Public. Anyone can find it in Discover."', () => {
        render(<RecipeVisibilityStatement />);

        expect(screen.getByLabelText(`${v.legend}: ${v.public}. ${v.publicHint}.`)).toBeTruthy();
    });

    it('shows the label, Public and the hint', () => {
        render(<RecipeVisibilityStatement />);

        expect(screen.getByText(v.legend)).toBeTruthy();
        expect(screen.getByText(v.public)).toBeTruthy();
        expect(screen.getByText(v.publicHint)).toBeTruthy();
    });

    it('⛔ offers no choice: no radio, no Private, no Premium', () => {
        render(<RecipeVisibilityStatement />);

        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByText(v.private)).toBeNull();
        expect(screen.queryByText(recipeFormMessages.en.premiumBadge)).toBeNull();
    });
});
