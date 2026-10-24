// @vitest-environment jsdom
/**
 * Component tests for the web "Who can see it: Public" statement, `RecipeVisibilityStatement` — what the editor shows
 * in place of the visibility field when Private is not offered (plan 2026-10-14-009 D14; owner ruling 2026-10-13: with
 * the paid features hidden, no paid feature and no upsell is visible). While the paid-feature state loads it is shown
 * too: nothing is offered that might have to be taken back.
 *
 * Why a statement and not a one-card radio group: a group with one option is not a choice (a screen reader announces
 * "1 of 1"), and a disabled Private card would itself be an upsell. Heuristic judgement, untested with users.
 *
 * Two facts added for the stuck-save defect and the make-public confirm (UX SPECIFY 2026-10-15): a kept draft's Private
 * the server will refuse is said, and the statement takes focus when it replaces the field the cook just used.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { editorMessages } from '../../editor/messages.js';
import { recipeFormMessages } from '../messages.js';
import { RecipeVisibilityStatement } from '../RecipeVisibilityStatement.js';

const v = editorMessages.en.visibility;

afterEach(cleanup);

describe('RecipeVisibilityStatement (web)', () => {
    it('says who can see the recipe: its label, Public, and the hint', () => {
        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(screen.getByText(v.legend)).toBeTruthy();
        expect(screen.getByText(v.public)).toBeTruthy();
        expect(screen.getByText(v.publicHint)).toBeTruthy();
        expect(screen.queryByText(v.privateUnavailable)).toBeNull();
    });

    it('⛔ offers no choice: no radio, no group, no Private, no Premium', () => {
        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByRole('group')).toBeNull();
        expect(screen.queryByText(v.private)).toBeNull();
        expect(screen.queryByText(recipeFormMessages.en.premiumBadge)).toBeNull();
    });

    it('says a kept draft`s Private will not be kept: the recipe will be public when it is published', () => {
        render(<RecipeVisibilityStatement privateUnavailable focusOnMount={false} />);

        expect(
            screen.getByText("Private isn't available, so this recipe will be public when you publish."),
        ).toBeTruthy();
    });

    it('⛔ takes the focus the field had when it replaces it, and never on an ordinary mount', () => {
        const { unmount } = render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(document.activeElement).toBe(document.body);
        unmount();

        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount />);

        expect(document.activeElement?.textContent).toContain(v.public);
        expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    });

    it('never takes focus from where the cook put it', () => {
        const field = document.createElement('input');
        document.body.append(field);
        field.focus();

        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount />);

        expect(document.activeElement).toBe(field);
        field.remove();
    });
});
