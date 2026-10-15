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
    /** What the server holds; defaults to the initial draft's visibility. */
    readonly saved?: RecipeVisibility;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onPremiumRequired?: () => void;
}

const Harness: FC<HarnessProps> = ({ initial, paidFeatures, saved, onChange, onPremiumRequired }) => {
    const [values, setValues] = useState(initial ?? defaultRecipeFormValues());
    const [savedVisibility] = useState(saved ?? values.visibility);

    return (
        <RecipeVisibilityField
            values={values}
            paidFeatures={paidFeatures}
            savedVisibility={savedVisibility}
            {...(onPremiumRequired === undefined ? {} : { onPremiumRequired })}
            onChange={(next) => {
                setValues(next);
                onChange?.(next);
            }}
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

    it('a recipe already private stays private under upsell go private, and can still go public', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="upsell"
                onChange={onChange}
            />,
        );

        expect(radio(v.private).checked).toBe(true);

        await user.click(radio(v.public));

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
    });

    // ── Plan 2026-10-14-009 D14: the field under each paid-feature state (the host renders the statement leaf instead
    //    when Private is not offered, so these are the states in which this leaf is on screen).
    it('under upsell, a recipe already private shows no Premium badge — going back to it is not a change', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="upsell" />);

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under hidden, a recipe already private stays private, shows no badge, and warns Public is final', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="hidden"
                onChange={onChange}
            />,
        );

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
        const finalNote = screen.getByText(v.publicIsFinal);
        const describedBy = radio(v.public).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy).toContain(finalNote.id);

        await user.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
    });

    it('under hidden, after choosing Public on a saved-private recipe, Private can still be chosen back', async () => {
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
        await user.click(radio(v.private));

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private' }));
    });

    it('under granted, no note says Public is final', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="granted" />);

        expect(screen.queryByText(v.publicIsFinal)).toBeNull();
    });
});
