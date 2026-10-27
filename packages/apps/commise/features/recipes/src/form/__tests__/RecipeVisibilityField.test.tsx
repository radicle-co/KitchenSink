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
import { recipePrivateRefusalOf, type RecipePrivateFacts } from '../../actions/recipePrivateGate.js';
import { editorMessages } from '../../editor/messages.js';
import { RecipeVisibilityField } from '../RecipeVisibilityField.js';
import { recipeFormMessages } from '../messages.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const v = editorMessages.en.visibility;

afterEach(cleanup);

interface HarnessProps {
    readonly initial?: RecipeFormValues;
    /** The paid-feature state. Without `facts`, the recipe is under the PREMIUM rule (an imported public-web recipe). */
    readonly paidFeatures: PaidFeatureState;
    /** The recipe's private facts, to exercise the SLOTS rule (a free cook's own, book or paid-site recipe). */
    readonly facts?: RecipePrivateFacts;
    /** What the server held when the editor opened; defaults to the initial draft's visibility. */
    readonly saved?: RecipeVisibility;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onPremiumRequired?: () => void;
    /**
     * What the host's confirm does. Defaults to a confirm the cook accepts, so a case can follow the choice through:
     * the draft becomes Public, as the host's Make public makes it.
     */
    readonly onConfirmPublic?: () => void;
    /** What "Make a private recipe public" / "Delete a private recipe" do from the full refusal. */
    readonly onFreeASlot?: () => void;
}

/** The host's wiring, as `usePrivateChoice` hands it over: the field decides from what the cook may still keep. */
const Harness: FC<HarnessProps> = ({
    initial,
    paidFeatures,
    facts: givenFacts,
    saved,
    onChange,
    onPremiumRequired,
    onConfirmPublic,
    onFreeASlot,
}) => {
    const facts: RecipePrivateFacts = givenFacts ?? {
        rule: 'premium',
        standing: { kind: 'unknown' },
        state: paidFeatures,
    };
    const [values, setValues] = useState(initial ?? defaultRecipeFormValues());
    const [opened] = useState(saved ?? values.visibility);

    const change = (next: RecipeFormValues): void => {
        setValues(next);
        onChange?.(next);
    };

    return (
        <RecipeVisibilityField
            values={values}
            facts={facts}
            heldVisibility={heldVisibility(opened, values.visibility)}
            privateRefusal={recipePrivateRefusalOf(facts)}
            onFreeASlot={onFreeASlot ?? (() => undefined)}
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

    it('shows no Pro badge to a granted cook', () => {
        render(<Harness paidFeatures="granted" />);

        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under upsell, Private carries the Pro badge, described on the choice', () => {
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
     *
     * REWRITTEN for the owner ruling of 2026-10-26: public is NEVER final. The `hidden` ("You won't be able to make it
     * private again") and `loading` ("You may not be able to") notes are gone. Under the premium rule only the upsell has
     * a cost to state; under the slots rule going public frees a slot.
     */
    it("⛔ under the premium rule's upsell, the Public card of a private recipe says Pro is needed to return", () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="upsell" />);

        const shown = screen.getByText("To make it private again, you'll need Pro.");
        const describedBy = radio(v.public).getAttribute('aria-describedby')?.split(' ') ?? [];

        expect(describedBy).toContain(shown.id);
    });

    it.each(['hidden', 'loading'] as const)(
        '⛔ under the premium rule with paid features %s, the Public card says nothing about cost (public is never final)',
        (state) => {
            render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures={state} />);

            expect(screen.queryByText(/won.t be able|may not be able/u)).toBeNull();
            expect(radio(v.public).getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
        },
    );

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
    it('under upsell, a recipe already private shows no Pro badge — going back to it is not a change', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="upsell" />);

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('under hidden, a recipe already private stays private and shows no badge or warning', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="hidden" />);

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
        expect(screen.queryByText(/private again/u)).toBeNull();
    });

    it('under hidden (premium rule), choosing Public on a private recipe goes public at once - there is no cost to confirm', async () => {
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

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        expect(onConfirmPublic).not.toHaveBeenCalled();
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

        expect(screen.queryByText(v.publicFrees)).toBeNull();
        expect(screen.queryByText(v.publicNeedsPremium)).toBeNull();
    });
});

describe('RecipeVisibilityField (web) - private slots (ADR-0073)', () => {
    const OPEN = { kind: 'open', used: 38, limit: 50, left: 12 } as const;
    const FULL = { kind: 'full', used: 50, limit: 50 } as const;
    const slots = (
        standing: RecipePrivateFacts['standing'],
        state: PaidFeatureState = 'upsell',
    ): RecipePrivateFacts => ({ rule: 'slots', standing, state });
    const PRIVATE_DRAFT = { ...defaultRecipeFormValues(), visibility: 'private' } as const;

    it('shows "N of 50 private slots left" where Private is chosen from, described on the choice', () => {
        render(<Harness paidFeatures="upsell" facts={slots(OPEN)} />);

        const line = screen.getByText('12 of 50 private slots left');

        expect(radio(v.private).getAttribute('aria-describedby')?.split(' ')).toContain(line.id);
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('choosing Private applies it and then says it uses 1 slot, with what is left after it', async () => {
        const user = userEvent.setup();
        render(<Harness paidFeatures="upsell" facts={slots(OPEN)} />);

        await user.click(radio(v.private));

        expect(radio(v.private).checked).toBe(true);
        expect(screen.getByText('This recipe uses 1 slot. 11 of 50 left after it.')).toBeTruthy();
    });

    it('Pro shows no count at all', () => {
        render(<Harness paidFeatures="granted" facts={slots({ kind: 'unlimited' }, 'granted')} />);

        expect(screen.queryByText(/private slots/u)).toBeNull();
    });

    it('says it is checking while the standing loads, and still lets the cook choose Private', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness paidFeatures="upsell" facts={slots({ kind: 'loading' })} onChange={onChange} />);

        expect(screen.getByText(v.slotsLoading)).toBeTruthy();

        await user.click(radio(v.private));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
    });

    it('⛔ with every slot used, Private is refused with the total, and choosing it changes nothing', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness paidFeatures="upsell" facts={slots(FULL)} onChange={onChange} />);

        const note = screen.getByText('Not available. All 50 of your private slots are in use.');

        expect(radio(v.private).getAttribute('aria-describedby')?.split(' ')).toContain(note.id);

        await user.click(radio(v.private));

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).checked).toBe(true);
    });

    it('the refusal offers three ways forward - make one public, delete one, take Pro - each described', () => {
        render(<Harness paidFeatures="upsell" facts={slots(FULL)} />);

        const group = screen.getByRole('group', { name: v.waysTitle });

        expect(
            within(group)
                .getAllByRole('button')
                .map((b) => b.textContent),
        ).toEqual([
            `${v.wayMakePublic}${v.wayMakePublicDetail}`,
            `${v.wayDelete}${v.wayDeleteDetail}`,
            `${v.wayPremium}${v.wayPremiumDetail}`,
        ]);
    });

    it('"Make a private recipe public" and "Delete a private recipe" both take the cook to their recipes; Pro opens the upsell', async () => {
        const user = userEvent.setup();
        const onFreeASlot = vi.fn();
        const onPremiumRequired = vi.fn();
        render(
            <Harness
                paidFeatures="upsell"
                facts={slots(FULL)}
                onFreeASlot={onFreeASlot}
                onPremiumRequired={onPremiumRequired}
            />,
        );

        await user.click(screen.getByRole('button', { name: new RegExp(v.wayMakePublic, 'u') }));
        await user.click(screen.getByRole('button', { name: new RegExp(v.wayDelete, 'u') }));
        expect(onFreeASlot).toHaveBeenCalledTimes(2);
        expect(onPremiumRequired).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: new RegExp(v.wayPremium, 'u') }));
        expect(onPremiumRequired).toHaveBeenCalledTimes(1);
    });

    it.each(['hidden', 'loading'] as const)('⛔ offers no Pro way when paid features are %s', (state) => {
        render(<Harness paidFeatures={state} facts={slots(FULL, state)} />);

        expect(screen.queryByRole('button', { name: new RegExp(v.wayPremium, 'u') })).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('a downgraded cook over the limit is told the limit', () => {
        render(<Harness paidFeatures="upsell" facts={slots({ kind: 'full', used: 60, limit: 50 })} />);

        expect(screen.getByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();
    });

    it('a recipe already private shows no refusal and no ways, even with every slot used: it holds its own', () => {
        render(<Harness initial={PRIVATE_DRAFT} paidFeatures="upsell" facts={slots(FULL)} />);

        expect(radio(v.private).checked).toBe(true);
        expect(screen.queryByRole('group', { name: v.waysTitle })).toBeNull();
    });

    it('⛔ a private recipe made public says it frees a slot, and asks to confirm first', async () => {
        const user = userEvent.setup();
        const onConfirmPublic = vi.fn();
        const onChange = vi.fn();
        render(
            <Harness
                initial={PRIVATE_DRAFT}
                paidFeatures="upsell"
                facts={slots(OPEN)}
                onConfirmPublic={onConfirmPublic}
                onChange={onChange}
            />,
        );

        const note = screen.getByText(v.publicFrees);

        expect(radio(v.public).getAttribute('aria-describedby')?.split(' ')).toContain(note.id);

        await user.click(radio(v.public));

        expect(onConfirmPublic).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('RecipeVisibilityField (web) - a book or paid-site recipe (private only)', () => {
    const REASON = 'Not for this recipe. Its source is a book or a paid site, not a public web page.';
    const PRIVATE_DRAFT = { ...defaultRecipeFormValues(), visibility: 'private' } as const;
    const privateOnly = (state: PaidFeatureState = 'upsell'): RecipePrivateFacts => ({
        rule: 'privateOnly',
        standing: { kind: 'open', used: 10, limit: 50, left: 40 },
        state,
    });
    const descriptionOf = (element: HTMLElement): string =>
        (element.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim();

    it('⛔ shows Public refused - aria-disabled, never natively disabled - with the reason as its description', () => {
        render(<Harness initial={PRIVATE_DRAFT} paidFeatures="upsell" facts={privateOnly()} />);

        const pub = radio(v.public);

        expect(pub.getAttribute('aria-disabled')).toBe('true');
        expect(pub.disabled).toBe(false);
        expect(descriptionOf(pub)).toBe(REASON);
        expect(screen.getByText(REASON)).toBeTruthy();
    });

    it('⛔ keeps the refused Public focusable: programmatically, from a click, and by arrowing onto it', async () => {
        const user = userEvent.setup();
        render(<Harness initial={PRIVATE_DRAFT} paidFeatures="upsell" facts={privateOnly()} />);

        radio(v.public).focus();
        expect(document.activeElement).toBe(radio(v.public));

        radio(v.private).focus();
        await user.keyboard('{ArrowUp}');
        expect(document.activeElement).toBe(radio(v.public));

        await user.click(radio(v.private));
        await user.click(radio(v.public));
        expect(document.activeElement).toBe(radio(v.public));
    });

    it('⛔ choosing the refused Public changes nothing, by click or by arrow, and the recipe stays Private', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onConfirmPublic = vi.fn();
        render(
            <Harness
                initial={PRIVATE_DRAFT}
                paidFeatures="upsell"
                facts={privateOnly()}
                onChange={onChange}
                onConfirmPublic={onConfirmPublic}
            />,
        );

        await user.click(radio(v.public));
        radio(v.private).focus();
        await user.keyboard('{ArrowUp}');

        expect(onChange).not.toHaveBeenCalled();
        expect(onConfirmPublic).not.toHaveBeenCalled();
        expect(radio(v.private).checked).toBe(true);
    });

    it('says the same with paid features hidden: the reason is about the source, not the plan', () => {
        render(<Harness initial={PRIVATE_DRAFT} paidFeatures="hidden" facts={privateOnly('hidden')} />);

        expect(descriptionOf(radio(v.public))).toBe(REASON);
    });

    it('⛔ Public is NOT refused for a recipe the cook wrote, or for an imported public-web recipe', () => {
        const { rerender } = render(
            <Harness initial={PRIVATE_DRAFT} paidFeatures="upsell" facts={{ ...privateOnly(), rule: 'slots' }} />,
        );

        expect(radio(v.public).getAttribute('aria-disabled')).toBeNull();
        expect(screen.queryByText(REASON)).toBeNull();

        rerender(<Harness initial={PRIVATE_DRAFT} paidFeatures="granted" />);

        expect(radio(v.public).getAttribute('aria-disabled')).toBeNull();
        expect(screen.queryByText(REASON)).toBeNull();
    });
});

describe('RecipeVisibilityField (web) - over the limit after a downgrade', () => {
    const OVER = { kind: 'full', used: 60, limit: 50 } as const;
    const AT = { kind: 'full', used: 50, limit: 50 } as const;
    const SENTENCE =
        'You have 60 private recipes and 50 private slots. They stay private. To make another recipe private, first bring your private recipes under 50.';
    const slots = (standing: RecipePrivateFacts['standing'], state: PaidFeatureState): RecipePrivateFacts => ({
        rule: 'slots',
        standing,
        state,
    });

    it('says what the cook holds, that it stays private, and what to do - from the server`s numbers', () => {
        render(<Harness paidFeatures="upsell" facts={slots(OVER, 'upsell')} />);

        expect(screen.getByText(SENTENCE)).toBeTruthy();
    });

    it('⛔ offers About Pro where paid features are shown, and it opens the upsell', async () => {
        const user = userEvent.setup();
        const onPremiumRequired = vi.fn();
        render(<Harness paidFeatures="upsell" facts={slots(OVER, 'upsell')} onPremiumRequired={onPremiumRequired} />);

        await user.click(screen.getByRole('button', { name: 'About Pro' }));

        expect(onPremiumRequired).toHaveBeenCalledOnce();
    });

    it.each(['hidden', 'loading'] as const)('⛔ offers no Pro link when paid features are %s', (state) => {
        render(<Harness paidFeatures={state} facts={slots(OVER, state)} />);

        expect(screen.getByText(SENTENCE)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Pro/u })).toBeNull();
    });

    it('is not said at exactly the limit: that is "all in use", not "over"', () => {
        render(<Harness paidFeatures="upsell" facts={slots(AT, 'upsell')} />);

        expect(screen.queryByText(/They stay private/u)).toBeNull();
        expect(screen.queryByRole('button', { name: 'About Pro' })).toBeNull();
    });

    it('is not said for a recipe that already holds its slot', () => {
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="upsell"
                facts={slots(OVER, 'upsell')}
            />,
        );

        expect(screen.queryByText(/They stay private/u)).toBeNull();
    });
});
