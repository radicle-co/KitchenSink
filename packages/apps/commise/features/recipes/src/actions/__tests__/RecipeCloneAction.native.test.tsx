/**
 * Native component tests for the recipe clone action (T075), rendered via react-native-web under jsdom.
 * Mirrors the web leaf: clone interaction, both disabled gates (cloning in-flight and not-cloneable), the
 * busy indicator, and the attribution line shown only when a source attribution is present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

import { cssColor } from '../../__tests__/cssColor.js';
import { pillOf } from '../../__tests__/dsPill.js';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCloneAction } from '../RecipeCloneAction.native.js';
import type { RecipeCloneActionProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderClone(overrides: Partial<RecipeCloneActionProps> = {}) {
    const props: RecipeCloneActionProps = {
        canClone: true,
        onClone: noop,
        ...overrides,
    };
    render(<RecipeCloneAction {...props} />);

    return props;
}

describe('RecipeCloneAction (native)', () => {
    it('reports clone requests upward', () => {
        const onClone = vi.fn();
        renderClone({ onClone });

        fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

        expect(onClone).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy indicator while cloning', () => {
        const onClone = vi.fn();
        renderClone({ cloning: true, onClone });

        const button = screen.getByRole('button', { name: 'Clone' });
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Cloning…')).toBeTruthy();

        fireEvent.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });

    it('disables the action when cloning is not allowed', () => {
        renderClone({ canClone: false });

        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('renders the attribution line when a source attribution is present', () => {
        renderClone({ sourceAttribution: 'Grandma’s cookbook' });

        expect(screen.getByText('Cloned from Grandma’s cookbook')).toBeTruthy();
    });

    it('omits the attribution line when no source attribution is present', () => {
        renderClone({ sourceAttribution: undefined });

        expect(screen.queryByText(/Cloned from/)).toBeNull();
    });
});

/**
 * Clone IS the design-system {@link Button} on native too — it does not paint its own surface.
 *
 * The leaf used to hand-roll a solid-coral pill and justify it with "the mockup paints the clone action CORAL,
 * and the DS variant set has no coral tier". That premise is false: NO mockup contains a clone action at all
 * (zero occurrences of clone/duplicate/fork across all nine screens), and the mockups' only coral BUTTON form
 * is a bordered outline — a solid coral fill appears nowhere except a selected allergy chip. Coral's documented
 * role is "destructive/secondary actions, highlights, warm accents", so the filled pill put a safe, additive,
 * reversible action into the danger register. Clone is a quiet SECONDARY action (the discovery-card leaf says
 * so in as many words), so both platforms now wear the DS `secondary` tier and cannot drift again.
 *
 * The 44pt floor / radius / busy assertions are KEPT: they used to guard a hand-rolled control, and they now
 * prove the DS Button actually delivers what the hand-rolled version was justified by.
 */
describe('RecipeCloneAction (native) — design-system surface', () => {
    it('meets the 44pt touch floor the DS Button guarantees', () => {
        renderClone();

        // `pillOf` throws when no 44pt surface exists, so reaching this line IS the assertion.
        expect(pillOf(screen.getByRole('button', { name: 'Clone' }))).toBeTruthy();
    });

    it('paints the DS secondary surface — a bordered white pill, NOT the old coral fill', () => {
        renderClone();
        const style = window.getComputedStyle(pillOf(screen.getByRole('button', { name: 'Clone' })));

        expect(style.backgroundColor).toBe(cssColor(palette.white));
        // The hairline comes from the shared semantic border token, so a re-theme moves it with the DS.
        expect(style.borderTopColor).toBe(cssColor(semantic.border));
        // The regression this replaces: a bespoke coral fill.
        expect(style.backgroundColor).not.toBe(cssColor(palette.coral));
    });

    it('labels in the tier foreground colour, not white-on-coral', () => {
        renderClone();

        // A leftover white label on the now-white surface would be invisible — assert the tier's charcoal.
        expect(window.getComputedStyle(screen.getByText('Clone')).color).toBe(cssColor(palette.charcoal));
    });

    it('rounds from the radius scale, not a magic 999', () => {
        renderClone();

        expect(window.getComputedStyle(pillOf(screen.getByRole('button', { name: 'Clone' }))).borderTopLeftRadius).toBe(
            `${nativeTokens.radius.full}px`,
        );
    });

    it('announces the in-flight state through NATIVE busy semantics, not a web-only aria-busy prop', () => {
        renderClone({ cloning: true });

        // `accessibilityState.busy` is what an on-device screen reader reads; react-native-web projects it to
        // `aria-busy`, which is what makes it assertable here. The DS Button/PressScale must not drop it.
        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-busy')).toBe('true');
    });

    it('reports NOT busy when idle', () => {
        renderClone();

        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-busy')).not.toBe('true');
    });

    it('pairs the label with an icon the accessibility tree never sees', () => {
        renderClone();

        // The DS Button requires an icon and hides it, so the label alone is the name (Maestro depends on it).
        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-label')).toBe('Clone');
    });
});
