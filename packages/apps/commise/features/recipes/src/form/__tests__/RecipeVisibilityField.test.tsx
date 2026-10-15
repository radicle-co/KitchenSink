// @vitest-environment jsdom
/**
 * Component tests for the web "Who can see it" field, `RecipeVisibilityField` (`docs/design/uiOverhaul/buildSpec.md`
 * §7.7 item 2): a radio group of two cards, and the premium gate on Private, which asks for the upsell and never
 * changes the value (nothing is pre-selected by the upsell).
 *
 * Moved here from `recipeFieldGroups.test.tsx`, whose visibility block pinned the wizard-era "Private recipe" checkbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import type { PaidFeatureState } from '@commise/features-account';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import { heldVisibility } from '../../actions/privateGate.js';
import { editorMessages } from '../../editor/messages.js';
import { RecipeVisibilityField } from '../RecipeVisibilityField.js';
import { recipeFormMessages } from '../messages.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const v = editorMessages.en.visibility;

afterEach(cleanup);

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

const radio = (name: string): HTMLInputElement => screen.getByRole<HTMLInputElement>('radio', { name });

describe('RecipeVisibilityField (web)', () => {
    it('is a group named "Who can see it" holding Public and Private, each with its hint', () => {
        render(<Harness paidFeatures="granted" />);

        const group = screen.getByRole('group', { name: v.legend });

        expect(
            within(group)
                .getAllByRole('radio')
                .map((option) => option.getAttribute('value')),
        ).toEqual(['public', 'private']);
        expect(radio(v.public).getAttribute('aria-describedby')).not.toBeNull();
        expect(screen.getByText(v.publicHint).id).toBe(radio(v.public).getAttribute('aria-describedby'));
        expect(screen.getByText(v.privateHint)).toBeTruthy();
    });

    it('keeps today`s default: Public', () => {
        render(<Harness paidFeatures="granted" />);

        expect(radio(v.public).checked).toBe(true);
        expect(radio(v.private).checked).toBe(false);
    });

    it('draws each choice as a card at least 56 px tall, the chosen one in the selected fill', () => {
        render(<Harness paidFeatures="granted" />);

        const publicCard = radio(v.public).closest('label');
        const privateCard = radio(v.private).closest('label');

        expect(publicCard?.className).toContain('min-h-14');
        expect(publicCard?.className).toContain('bg-selected-fill');
        expect(privateCard?.className).toContain('bg-paper');
        expect(privateCard?.className).not.toContain('bg-selected-fill');
    });

    it('a granted cook chooses Private, and back to Public', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness paidFeatures="granted" onChange={onChange} />);

        await user.click(radio(v.private));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private' }));
        expect(radio(v.private).checked).toBe(true);

        await user.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
    });

    it('shows no Premium badge to a granted cook', () => {
        render(<Harness paidFeatures="granted" />);

        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under upsell, Private carries the Premium badge, described on the choice', () => {
        render(<Harness paidFeatures="upsell" />);

        const badge = screen.getByText(m.premiumBadge);
        const describedBy = radio(v.private).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy.some((id) => document.getElementById(id)?.contains(badge) === true)).toBe(true);
    });

    it('under upsell, choosing Private asks for the upsell and leaves the value', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onPremiumRequired = vi.fn();
        render(<Harness paidFeatures="upsell" onChange={onChange} onPremiumRequired={onPremiumRequired} />);

        await user.click(radio(v.private));

        expect(onPremiumRequired).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
        expect(radio(v.private).checked).toBe(false);
    });

    // ⚠️ The arrow key selects the radio, which asks for the upsell (an SC 3.2.2 question raised in the slice report).
    it('arrowing onto Private does not move the choice', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onPremiumRequired = vi.fn();
        render(<Harness paidFeatures="upsell" onChange={onChange} onPremiumRequired={onPremiumRequired} />);

        radio(v.public).focus();
        await user.keyboard('{ArrowDown}');

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
    });

    it('with no upsell wired, choosing Private does nothing', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness paidFeatures="upsell" onChange={onChange} />);

        await user.click(radio(v.private));

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
    });

    it('⛔ under upsell, a recipe already private stays private, and going public asks to confirm first', async () => {
        const user = userEvent.setup();
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

        expect(radio(v.private).checked).toBe(true);

        await user.click(radio(v.public));

        expect(onConfirmPublic).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.private).checked).toBe(true);
    });

    it('a granted cook makes a private recipe public at once, with no confirm', async () => {
        const user = userEvent.setup();
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

        await user.click(radio(v.public));

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        expect(onConfirmPublic).not.toHaveBeenCalled();
    });

    /**
     * WCAG 3.2.2 On Input: a radio whose choice opens a dialog must say so before it is used. So the Public card carries
     * the consequence in EVERY state in which the confirm can open, and in none in which it cannot.
     */
    it.each([
        ['hidden', "You won't be able to make it private again."],
        ['upsell', "To make it private again, you'll need Premium."],
        ['loading', 'You may not be able to make it private again.'],
    ] as const)('⛔ under %s, the Public card of a private recipe says what going public costs', (state, note) => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures={state} />);

        const shown = screen.getByText(note);
        const describedBy = radio(v.public).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy).toContain(shown.id);
    });

    it('⛔ a kept draft`s Private for a recipe not held private shows Public under upsell, and says why', () => {
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                saved="public"
                paidFeatures="upsell"
            />,
        );

        expect(radio(v.public).checked).toBe(true);
        expect(radio(v.private).checked).toBe(false);
        const note = screen.getByText(v.privatePremiumOnly);
        const describedBy = radio(v.public).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy).toContain(note.id);
    });

    // ── Plan 2026-10-14-009 D14: the field under each paid-feature state (the host renders the statement leaf instead
    //    when Private is not offered, so these are the states in which this leaf is on screen).
    it('under upsell, a recipe already private shows no Premium badge — going back to it is not a change', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="upsell" />);

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under hidden, a recipe already private stays private, shows no badge, and warns Public is final', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="hidden" />);

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
        const finalNote = screen.getByText(v.publicIsFinal);
        const describedBy = radio(v.public).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy).toContain(finalNote.id);
    });

    it('⛔ under hidden, choosing Public on a private recipe asks to confirm and leaves the value', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onConfirmPublic = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="hidden"
                onChange={onChange}
                onConfirmPublic={onConfirmPublic}
            />,
        );

        await user.click(radio(v.public));

        expect(onConfirmPublic).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.private).checked).toBe(true);
    });

    /**
     * REWRITTEN for the stuck-save defect: this case used to pin that Private could be chosen back after Public, which is
     * exactly the write the server refused. Once the cook has confirmed Public, Private changes nothing (the host shows
     * the statement in place of this field).
     */
    it('⛔ under hidden, once Public is confirmed, choosing Private again changes nothing', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="hidden"
                onChange={onChange}
            />,
        );

        await user.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        onChange.mockClear();

        await user.click(radio(v.private));

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
    });

    it('under granted, no note says what going public costs', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="granted" />);

        expect(screen.queryByText(v.publicIsFinal)).toBeNull();
        expect(screen.queryByText(v.publicNeedsPremium)).toBeNull();
        expect(screen.queryByText(v.publicMayBeFinal)).toBeNull();
    });
});
