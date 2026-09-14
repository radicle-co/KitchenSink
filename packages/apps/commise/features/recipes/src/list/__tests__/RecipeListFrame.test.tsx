// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list FRAME — the chrome that renders outside the list's suspense boundary, so a
 * pending or failed read never unmounts the heading, the source switcher or the field the viewer is typing in.
 *
 * Moved from the retired `RecipeList.test.tsx` ("chrome", "U8 brand title band", "source tabs (L5)", the search
 * field's contrast and focus ring, and the notice's focus move — which now arrives as the frame's
 * `headingFocusSignal`, because the notice sits inside the boundary and the heading outside it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { RecipeListFrame } from '../RecipeListFrame.js';
import type { RecipeListFrameProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

/** The source switcher's destinations — the web app's real `/{locale}/…` pair. */
const HREF = { mine: '/en/recipes', community: '/en/discover' } as const;

function frame(overrides: Partial<RecipeListFrameProps> = {}) {
    return (
        <RecipeListFrame searchValue="" onSearchChange={noop} headingFocusSignal={0} {...overrides}>
            {overrides.children ?? <p>boundary content</p>}
        </RecipeListFrame>
    );
}

describe('RecipeListFrame (web) — chrome', () => {
    it('renders the heading, the search field and whatever the boundary below it renders', () => {
        render(frame());

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reflects the controlled search value', () => {
        render(frame({ searchValue: 'risotto' }));

        expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('risotto');
    });

    it('reports search input changes upward', () => {
        const onSearchChange = vi.fn();
        render(frame({ onSearchChange }));

        // fireEvent.change, not user.type: this harness renders a static `searchValue`, so React's controlled-input
        // restoration resets the field after every keystroke and user.type would report single characters.
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lamb' } });

        expect(onSearchChange).toHaveBeenCalledWith('lamb');
    });
});

describe('RecipeListFrame (web) — U8 brand title band', () => {
    it('sits the heading in a brand gradient title band', () => {
        const { container } = render(frame());

        // GradientSurface (web) paints an inline linear-gradient background behind the header.
        const band = Array.from(container.querySelectorAll<HTMLElement>('*')).find((el) =>
            el.style.backgroundImage.startsWith('linear-gradient'),
        );

        expect(band).toBeDefined();
        expect(band?.querySelector('h1')).not.toBeNull();
    });

    it('threads the Playfair display family onto the list heading', () => {
        render(frame());

        expect(screen.getByRole('heading', { name: 'Recipes' }).className).toContain('font-display');
    });
});

// The switcher's own contract — link semantics, affordance, contrast and touch targets — is owned by
// `RecipeSourceTabs.test.tsx`. What belongs HERE is the composition: that the frame mounts it.
describe('RecipeListFrame (web) — source tabs (L5)', () => {
    it('renders no source switcher when no tab prop is given', () => {
        render(frame());

        expect(screen.queryByRole('navigation', { name: 'Recipe source' })).toBeNull();
    });

    it('mounts the shared switcher with the active source marked and BOTH destinations reachable', () => {
        render(frame({ tab: { active: 'mine', href: HREF } }));

        const nav = screen.getByRole('navigation', { name: 'Recipe source' });
        expect(within(nav).getByRole('link', { name: 'My Recipes' }).getAttribute('aria-current')).toBe('page');
        expect(within(nav).getByRole('link', { name: 'Community' }).getAttribute('href')).toBe('/en/discover');
    });
});

describe('RecipeListFrame (web) — the heading takes focus when a refresh recovers', () => {
    it('⛔ moves focus to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(frame());

        expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Recipes' }));

        rerender(frame({ headingFocusSignal: 1 }));

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recipes' }));
    });
});

describe('RecipeListFrame (web) — text contrast (WCAG 2.1 AA)', () => {
    it('keeps the search field’s PLACEHOLDER text legible on the field', () => {
        render(frame());

        // Placeholder copy is TEXT — the field's only visible instruction before they type — so it owes 4.5:1;
        // `mist` measured 1.90:1 here. Measured as its own `placeholder:` variant, since the base `text-charcoal`
        // is the VALUE colour and would mask the defect.
        expect(
            utilityContrast(screen.getByRole('searchbox', { name: 'Search recipes' }).className, {
                surface: semantic.card,
                variant: 'placeholder',
            }),
            'recipe-list search placeholder on the card-white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The frame is a `<section>` on the app background, so that is the surface its search field's focus ring is drawn
 * on — a Tailwind `ring-*` is a spread box-shadow OUTSIDE the border box. The ring shipped as `ring-seafoam-light`
 * (2.58:1), under the 3:1 SC 1.4.11 floor (#114), and `outline-none` makes it the ONLY focus indicator.
 */
describe('RecipeListFrame (web) — the search field’s focus ring clears the 3:1 SC 1.4.11 floor', () => {
    it('rings the search box legibly against the page it sits on', () => {
        render(frame());

        const search = screen.getByRole('searchbox', { name: 'Search recipes' });

        expect(search.className, 'the browser outline is suppressed, so the ring is the whole indicator') //
            .toContain('outline-none');
        expect(
            ringContrast(search.className, { surface: semantic.background }),
            'recipe-search focus ring',
        ).toBeGreaterThanOrEqual(3);
    });

    it('out-measures the `seafoam-light` it replaced', () => {
        render(frame());

        expect(
            ringContrast(screen.getByRole('searchbox', { name: 'Search recipes' }).className, {
                surface: semantic.background,
            }),
        ).toBeGreaterThan(ringContrast('ring-2 ring-seafoam-light', { surface: semantic.background }));
    });
});
