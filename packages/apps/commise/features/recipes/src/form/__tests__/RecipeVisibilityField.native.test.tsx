/**
 * Native component tests for "Who can see it", `RecipeVisibilityField.native` (`docs/design/uiOverhaul/buildSpec.md`
 * §7.7 item 2), rendered through react-native-web under jsdom. Mirrors `RecipeVisibilityField.test.tsx`, plus both
 * colour schemes.
 *
 * Moved here from `recipeFieldGroups.native.test.tsx`, whose visibility block pinned the wizard-era switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

import type { PaidFeatureState } from '@commise/features-account';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import { heldVisibility } from '../../actions/privateGate.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { editorMessages } from '../../editor/messages.js';
import { RecipeVisibilityField } from '../RecipeVisibilityField.native.js';
import { recipeFormMessages } from '../messages.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const v = editorMessages.en.visibility;

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

interface HarnessProps {
    readonly initial?: RecipeFormValues;
    readonly paidFeatures: PaidFeatureState;
    /** What the server held when the editor opened; defaults to the initial draft's visibility. */
    readonly saved?: RecipeVisibility;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onPremiumRequired?: () => void;
    /**
     * What the host's confirm does. Defaults to a confirm the cook accepts, so a case can follow the choice through:
     * the draft becomes Public, as the host's Make public makes it.
     */
    readonly onConfirmPublic?: () => void;
}

/** The host's wiring, as `usePrivateChoice` hands it over: the field decides from what the cook may still keep. */
const Harness: FC<HarnessProps> = ({ initial, paidFeatures, saved, onChange, onPremiumRequired, onConfirmPublic }) => {
    const [values, setValues] = useState(initial ?? defaultRecipeFormValues());
    const [opened] = useState(saved ?? values.visibility);

    const change = (next: RecipeFormValues): void => {
        setValues(next);
        onChange?.(next);
    };

    return (
        <RecipeVisibilityField
            values={values}
            paidFeatures={paidFeatures}
            savedVisibility={heldVisibility(opened, values.visibility)}
            {...(onPremiumRequired === undefined ? {} : { onPremiumRequired })}
            onConfirmPublic={onConfirmPublic ?? (() => change({ ...values, visibility: 'public' }))}
            onChange={change}
        />
    );
};

/**
 * A card by its title. Its accessible name is its whole text — title, hint and, when shown, the badge — which jsdom joins
 * with no space (it lays nothing out), so the names are matched as runs of words rather than as one sentence.
 */
const radio = (title: string): HTMLElement => screen.getByRole('radio', { name: new RegExp(`^${title}`, 'u') });

describe('RecipeVisibilityField (native)', () => {
    it('is a radio group named "Who can see it" of Public and Private, Public chosen by default', () => {
        render(<Harness paidFeatures="granted" />);

        const group = screen.getByRole('radiogroup', { name: v.legend });

        expect(within(group).getAllByRole('radio')).toHaveLength(2);
        expect(radio(v.public).getAttribute('aria-checked')).toBe('true');
        expect(radio(v.private).getAttribute('aria-checked')).toBe('false');
        expect(screen.getByRole('radio', { name: new RegExp(`^${v.public}\\s*${v.publicHint}$`, 'u') })).toBeTruthy();
        expect(screen.getByRole('radio', { name: new RegExp(`^${v.private}\\s*${v.privateHint}$`, 'u') })).toBeTruthy();
    });

    it.each(['light', 'dark'] as const)('paints the chosen card in the selected fill in the %s scheme', (scheme) => {
        systemScheme.current = scheme;
        render(<Harness paidFeatures="granted" />);
        const theme = scheme === 'dark' ? roleDark : role;

        expect(getComputedStyle(radio(v.public)).backgroundColor).toBe(rgb(theme.selectedFill));
        expect(getComputedStyle(radio(v.private)).backgroundColor).toBe(rgb(theme.paper));
        expect(getComputedStyle(radio(v.public)).minHeight).toBe('56px');
    });

    it('a granted cook chooses Private, and back', () => {
        const onChange = vi.fn();
        render(<Harness paidFeatures="granted" onChange={onChange} />);

        fireEvent.click(radio(v.private));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private' }));
        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under upsell, Private shows Premium, asks for the upsell and leaves the value', () => {
        const onChange = vi.fn();
        const onPremiumRequired = vi.fn();
        render(<Harness paidFeatures="upsell" onChange={onChange} onPremiumRequired={onPremiumRequired} />);

        expect(
            screen.getByRole('radio', {
                name: new RegExp(`^${v.private}\\s*${v.privateHint}\\s*${m.premiumBadge}$`, 'u'),
            }),
        ).toBeTruthy();

        fireEvent.click(radio(v.private));

        expect(onPremiumRequired).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).getAttribute('aria-checked')).toBe('true');
    });

    it('⛔ under upsell, a recipe already private stays private, and going public asks to confirm first', () => {
        const onChange = vi.fn();
        const onConfirmPublic = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="upsell"
                onChange={onChange}
                onConfirmPublic={onConfirmPublic}
            />,
        );

        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(radio(v.public));

        expect(onConfirmPublic).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');
    });

    it('a granted cook makes a private recipe public at once, with no confirm', () => {
        const onChange = vi.fn();
        const onConfirmPublic = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="granted"
                onChange={onChange}
                onConfirmPublic={onConfirmPublic}
            />,
        );

        fireEvent.click(radio(v.public));

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        expect(onConfirmPublic).not.toHaveBeenCalled();
    });

    // WCAG 3.2.2: the Public card says what going public costs in every state in which the confirm can open.
    it.each([
        ['hidden', v.publicIsFinal],
        ['upsell', v.publicNeedsPremium],
        ['loading', v.publicMayBeFinal],
    ] as const)('⛔ under %s, the Public card of a private recipe says what going public costs', (state, note) => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures={state} />);

        expect(
            screen.getByRole('radio', { name: new RegExp(`^${v.public}\\s*${v.publicHint}\\s*${note}$`, 'u') }),
        ).toBeTruthy();
    });

    it('⛔ a kept draft`s Private for a recipe not held private shows Public under upsell, and says why', () => {
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                saved="public"
                paidFeatures="upsell"
            />,
        );

        expect(radio(v.public).getAttribute('aria-checked')).toBe('true');
        expect(radio(v.private).getAttribute('aria-checked')).toBe('false');
        expect(screen.getByText(v.privatePremiumOnly)).toBeTruthy();
    });

    // ── Plan 2026-10-14-009 D14: the field under each paid-feature state.
    it('under upsell, a recipe already private shows no Premium badge', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="upsell" />);

        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under hidden, a recipe already private stays private, shows no badge, and warns Public is final', () => {
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="hidden"
                onChange={onChange}
            />,
        );

        expect(screen.queryByText(m.premiumBadge)).toBeNull();
        expect(
            screen.getByRole('radio', {
                name: new RegExp(`^${v.public}\\s*${v.publicHint}\\s*${v.publicIsFinal}$`, 'u'),
            }),
        ).toBeTruthy();

        fireEvent.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        onChange.mockClear();

        // The stuck-save defect: once Public is confirmed, Private changes nothing.
        fireEvent.click(radio(v.private));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('under granted, no note says what going public costs', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="granted" />);

        expect(screen.queryByText(v.publicIsFinal)).toBeNull();
        expect(screen.queryByText(v.publicNeedsPremium)).toBeNull();
        expect(screen.queryByText(v.publicMayBeFinal)).toBeNull();
    });
});
