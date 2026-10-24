/**
 * Native component tests for `RecipeVisibilityStatement.native` (plan 2026-10-14-009 D14), rendered through
 * react-native-web under jsdom. Mirrors `RecipeVisibilityStatement.test.tsx`: the statement the editor shows in place
 * of the visibility field when Private is not offered, read as ONE element by a screen reader; the note for a kept
 * draft's refused Private; and the screen-reader cursor moving onto it when it replaces the field the cook just used.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { editorMessages } from '../../editor/messages.js';
import { recipeFormMessages } from '../messages.js';
import { RecipeVisibilityStatement } from '../RecipeVisibilityStatement.native.js';

const v = editorMessages.en.visibility;

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

describe('RecipeVisibilityStatement (native)', () => {
    it('is read as one element: "Who can see it: Public. Anyone can find it in Discover."', () => {
        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(screen.getByLabelText(`${v.legend}: ${v.public}. ${v.publicHint}.`)).toBeTruthy();
    });

    it('shows the label, Public and the hint', () => {
        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(screen.getByText(v.legend)).toBeTruthy();
        expect(screen.getByText(v.public)).toBeTruthy();
        expect(screen.getByText(v.publicHint)).toBeTruthy();
    });

    it('⛔ offers no choice: no radio, no Private, no Premium', () => {
        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByText(v.private)).toBeNull();
        expect(screen.queryByText(recipeFormMessages.en.premiumBadge)).toBeNull();
    });

    it('says, in the one element, that a kept draft`s Private will not be kept', () => {
        render(<RecipeVisibilityStatement privateUnavailable focusOnMount={false} />);

        expect(
            screen.getByLabelText(
                `${v.legend}: ${v.public}. ${v.publicHint}. Private isn't available, so this recipe will be public when you publish.`,
            ),
        ).toBeTruthy();
    });

    it('⛔ moves the screen-reader cursor onto itself when it replaces the field, and never on an ordinary mount', () => {
        const { unmount } = render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount={false} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        unmount();

        render(<RecipeVisibilityStatement privateUnavailable={false} focusOnMount />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByLabelText(`${v.legend}: ${v.public}. ${v.publicHint}.`),
            'focus',
        );
    });
});
