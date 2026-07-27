/**
 * Native component tests for the recipe clone action (T075), rendered via react-native-web under jsdom.
 * Mirrors the web leaf: clone interaction, both disabled gates (cloning in-flight and not-cloneable), the
 * busy indicator, and the attribution line shown only when a source attribution is present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

import { cssColor } from './cssColor.js';

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
 * Control quality for a control that deliberately is NOT the design-system {@link Button}.
 *
 * The mockup language paints the clone action CORAL, and the DS variant set has no coral tier — adopting
 * `primary` would silently recolour it to the seafoam brand gradient AND diverge from the web leaf, which
 * stays hand-rolled for this exact reason (see its own comment: "tracked as a DS-variant question, not papered
 * over"). So the component stays hand-rolled, and the properties the DS Button would otherwise have
 * guaranteed are asserted here instead — otherwise "kept for a good reason" silently means "kept the defects".
 */
describe('RecipeCloneAction (native) — control quality', () => {
    it('meets the 44pt touch floor the DS Button would have guaranteed', () => {
        renderClone();

        expect(window.getComputedStyle(screen.getByRole('button', { name: 'Clone' })).minHeight).toBe('44px');
    });

    it('keeps the mockup coral fill — the reason it is not a DS Button in the first place', () => {
        renderClone();

        // If this ever becomes the brand gradient, the "no coral tier" justification has silently expired and
        // the control should move to the DS variant that replaced it.
        expect(window.getComputedStyle(screen.getByRole('button', { name: 'Clone' })).backgroundColor).toBe(
            cssColor(palette.coral),
        );
    });

    it('rounds from the radius scale, not a magic 999', () => {
        renderClone();

        expect(window.getComputedStyle(screen.getByRole('button', { name: 'Clone' })).borderTopLeftRadius).toBe(
            `${nativeTokens.radius.full}px`,
        );
    });

    it('announces the in-flight state through NATIVE busy semantics, not a web-only aria-busy prop', () => {
        renderClone({ cloning: true });

        // `aria-busy` as a literal RN prop is a web-ism that react-native-web happens to pass through and a
        // real device ignores; `accessibilityState.busy` is what an on-device screen reader reads.
        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-busy')).toBe('true');
    });

    it('reports NOT busy when idle', () => {
        renderClone();

        expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('aria-busy')).not.toBe('true');
    });
});
