/**
 * Native component tests for the recipe-list FRAME (react-native-web under jsdom) — the chrome that renders outside
 * the list's suspense boundary. Mirrors `RecipeListFrame.test.tsx`.
 *
 * Moved from the retired `RecipeList.native.test.tsx` ("chrome", "U8 brand title band", "source tabs (L5)", the search
 * placeholder's contrast, and the notice's screen-reader hand-off — which now arrives as `headingFocusSignal`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo, Text } from 'react-native';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { placeholderContrast } from '@commise/test-utils';
import { nativeTokens } from '@commise/ui/native';
import { palette } from '@commise/ui';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeListFrame } from '../RecipeListFrame.native.js';
import type { RecipeListFrameProps } from '../model.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
});

const noop = () => undefined;

/** The source switcher's destinations. Native ignores them (its shell has no URLs) — see the control's JSDoc. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

function frame(overrides: Partial<RecipeListFrameProps> = {}) {
    return (
        <RecipeListFrame searchValue="" onSearchChange={noop} headingFocusSignal={0} {...overrides}>
            {overrides.children ?? <Text>boundary content</Text>}
        </RecipeListFrame>
    );
}

describe('RecipeListFrame (native) — chrome', () => {
    it('renders the heading, the search field and whatever the boundary below it renders', () => {
        render(frame());

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByLabelText('Search recipes')).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        render(frame({ onSearchChange }));

        fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });
});

describe('RecipeListFrame (native) — U8 brand title band', () => {
    // React Native renders a CSS font stack as the system font, silently. `getComputedStyle` does not resolve
    // react-native-web's class-compiled family, so this reads the injected declaration and rejects any stack.
    it('paints the heading in the registered bold Playfair face, never a CSS font stack', () => {
        render(frame());

        const applied = appliedFontFamily(screen.getByRole('heading', { name: 'Recipes' }));

        expect(applied).toBe(nativeTokens.fontFace.display.bold);
        expect(applied).not.toContain(',');
    });

    it('sits the heading in a brand gradient title band', () => {
        const { container } = render(frame());

        const band = container.querySelector('[data-commise-stub="linear-gradient"]');
        expect(band).not.toBeNull();
        expect(band?.querySelector('[role="heading"]')).not.toBeNull();
    });
});

// The switcher's own contract is owned by `RecipeSourceTabs.native.test.tsx`; HERE is the composition.
describe('RecipeListFrame (native) — source tabs (L5)', () => {
    it('renders no source switcher when no tab prop is given', () => {
        render(frame());

        expect(screen.queryByText('Community')).toBeNull();
    });

    it('mounts the shared switcher with the active source marked and both sources reachable', () => {
        const onChange = vi.fn();
        render(frame({ tab: { active: 'mine', href: HREF, onChange } }));

        expect(screen.getByRole('tab', { name: 'My Recipes' }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(screen.getByRole('tab', { name: 'Community' }));

        expect(onChange).toHaveBeenCalledWith('community');
    });
});

describe('RecipeListFrame (native) — the heading takes the screen-reader cursor when a refresh recovers', () => {
    it('⛔ sends focus to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(frame());

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(frame({ headingFocusSignal: 1 }));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Recipes' }),
            'focus',
        );
    });
});

describe('RecipeListFrame (native) — text contrast (WCAG 2.1 AA)', () => {
    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        render(frame());

        // `placeholderContrast` reads the colour react-native-web actually paints and composites the field's own
        // background over the screen, so this fails if the token drifts AND if the prop stops being passed.
        expect(
            placeholderContrast(screen.getByLabelText('Search recipes'), { surface: palette.sand }),
            'recipe-list search placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * Read back the `font-family` react-native-web ACTUALLY applied to `element`: RNW compiles a `StyleSheet` family into
 * an atomic `r-fontFamily-*` class whose rule jsdom's `getComputedStyle` does not resolve, so the honest read is the
 * injected declaration itself. `undefined` when the element carries no compiled family.
 */
function appliedFontFamily(element: Element): string | undefined {
    const className = element.className.split(' ').find((name) => name.startsWith('r-fontFamily-'));

    if (className === undefined) {
        return undefined;
    }

    const sheets = document.styleSheets;

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
        const rules = sheets[sheetIndex]?.cssRules;

        for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
            const rule = rules?.[ruleIndex];

            if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                return rule.style.getPropertyValue('font-family');
            }
        }
    }

    return undefined;
}
