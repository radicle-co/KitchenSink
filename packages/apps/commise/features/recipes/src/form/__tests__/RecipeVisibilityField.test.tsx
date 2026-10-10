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

import { editorMessages } from '../../editor/messages.js';
import { RecipeVisibilityField } from '../RecipeVisibilityField.js';
import { recipeFormMessages } from '../messages.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const v = editorMessages.en.visibility;

afterEach(cleanup);

interface HarnessProps {
    readonly initial?: RecipeFormValues;
    readonly canGoPrivate: boolean;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onPremiumRequired?: () => void;
}

const Harness: FC<HarnessProps> = ({ initial, canGoPrivate, onChange, onPremiumRequired }) => {
    const [values, setValues] = useState(initial ?? defaultRecipeFormValues());

    return (
        <RecipeVisibilityField
            values={values}
            canGoPrivate={canGoPrivate}
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
        render(<Harness canGoPrivate />);

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
        render(<Harness canGoPrivate />);

        expect(radio(v.public).checked).toBe(true);
        expect(radio(v.private).checked).toBe(false);
    });

    it('draws each choice as a card at least 56 px tall, the chosen one in the selected fill', () => {
        render(<Harness canGoPrivate />);

        const publicCard = radio(v.public).closest('label');
        const privateCard = radio(v.private).closest('label');

        expect(publicCard?.className).toContain('min-h-14');
        expect(publicCard?.className).toContain('bg-selected-fill');
        expect(privateCard?.className).toContain('bg-paper');
        expect(privateCard?.className).not.toContain('bg-selected-fill');
    });

    it('a cook who can go private chooses Private, and back to Public', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness canGoPrivate onChange={onChange} />);

        await user.click(radio(v.private));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private' }));
        expect(radio(v.private).checked).toBe(true);

        await user.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
    });

    it('shows no Premium badge to a cook who can go private', () => {
        render(<Harness canGoPrivate />);

        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('for a cook who cannot, Private carries the Premium badge, described on the choice', () => {
        render(<Harness canGoPrivate={false} />);

        const badge = screen.getByText(m.premiumBadge);
        const describedBy = radio(v.private).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy.some((id) => document.getElementById(id)?.contains(badge) === true)).toBe(true);
    });

    it('for a cook who cannot, choosing Private asks for the upsell and leaves the value', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onPremiumRequired = vi.fn();
        render(<Harness canGoPrivate={false} onChange={onChange} onPremiumRequired={onPremiumRequired} />);

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
        render(<Harness canGoPrivate={false} onChange={onChange} onPremiumRequired={onPremiumRequired} />);

        radio(v.public).focus();
        await user.keyboard('{ArrowDown}');

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
    });

    it('with no upsell wired, choosing Private does nothing', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness canGoPrivate={false} onChange={onChange} />);

        await user.click(radio(v.private));

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
    });

    it('a recipe already private stays private for a cook who cannot go private, and can still go public', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                canGoPrivate={false}
                onChange={onChange}
            />,
        );

        expect(radio(v.private).checked).toBe(true);

        await user.click(radio(v.public));

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
    });
});
