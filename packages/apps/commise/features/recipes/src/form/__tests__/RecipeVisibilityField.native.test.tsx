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
import { recipePrivateRefusalOf, type RecipePrivateFacts } from '../../actions/recipePrivateGate.js';
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
    /** The paid-feature state. Without `facts`, the recipe is under the PREMIUM rule (an imported public-web recipe). */
    readonly paidFeatures: PaidFeatureState;
    /** The recipe's private facts, to exercise the SLOTS rule. */
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
                name: new RegExp(`^${v.private}\\s*${v.privateHint}\\s*${v.webPrivate}\\s*${m.premiumBadge}$`, 'u'),
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

    // WCAG 3.2.2: the Public card says what going public costs in every state in which the confirm can open. REWRITTEN for
    // the owner ruling of 2026-10-26: public is NEVER final, so the hidden/loading notes are gone.
    it("⛔ under the premium rule's upsell, the Public card of a private recipe says Premium is needed to return", () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="upsell" />);

        expect(
            screen.getByRole('radio', {
                name: new RegExp(`^${v.public}\\s*${v.publicHint}\\s*${v.publicNeedsPremium}$`, 'u'),
            }),
        ).toBeTruthy();
    });

    it.each(['hidden', 'loading'] as const)(
        '⛔ under the premium rule with paid features %s, the Public card says nothing about cost',
        (state) => {
            render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures={state} />);

            expect(
                screen.getByRole('radio', { name: new RegExp(`^${v.public}\\s*${v.publicHint}$`, 'u') }),
            ).toBeTruthy();
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

    it('under hidden (premium rule), a recipe already private stays private; Public is at once, and Private then changes nothing', () => {
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                paidFeatures="hidden"
                onChange={onChange}
            />,
        );

        expect(screen.queryByText(m.premiumBadge)).toBeNull();

        fireEvent.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        onChange.mockClear();

        // The stuck-save defect: once Public is confirmed, Private changes nothing.
        fireEvent.click(radio(v.private));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('under granted, no note says what going public costs', () => {
        render(<Harness initial={{ ...defaultRecipeFormValues(), visibility: 'private' }} paidFeatures="granted" />);

        expect(screen.queryByText(v.publicFrees)).toBeNull();
        expect(screen.queryByText(v.publicNeedsPremium)).toBeNull();
    });
});

describe('RecipeVisibilityField (native) - private slots (ADR-0073)', () => {
    const OPEN = { kind: 'open', used: 38, limit: 50, left: 12 } as const;
    const FULL = { kind: 'full', used: 50, limit: 50 } as const;
    const slots = (
        standing: RecipePrivateFacts['standing'],
        state: PaidFeatureState = 'upsell',
    ): RecipePrivateFacts => ({ rule: 'slots', standing, state });
    const PRIVATE_DRAFT = { ...defaultRecipeFormValues(), visibility: 'private' } as const;

    it('shows "N of 50 private slots left" where Private is chosen from', () => {
        render(<Harness paidFeatures="upsell" facts={slots(OPEN)} />);

        expect(screen.getByText('12 of 50 private slots left')).toBeTruthy();
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('choosing Private applies it and then says it uses 1 slot, with what is left after it', () => {
        render(<Harness paidFeatures="upsell" facts={slots(OPEN)} />);

        fireEvent.click(radio(v.private));

        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('This recipe uses 1 slot. 11 of 50 left after it.')).toBeTruthy();
    });

    it('Premium shows no count at all', () => {
        render(<Harness paidFeatures="granted" facts={slots({ kind: 'unlimited' }, 'granted')} />);

        expect(screen.queryByText(/private slots/u)).toBeNull();
    });

    it('says it is checking while the standing loads, and still lets the cook choose Private', () => {
        const onChange = vi.fn();
        render(<Harness paidFeatures="upsell" facts={slots({ kind: 'loading' })} onChange={onChange} />);

        expect(screen.getByText(v.slotsLoading)).toBeTruthy();

        fireEvent.click(radio(v.private));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
    });

    it('⛔ with every slot used, Private is refused with the total, and choosing it changes nothing', () => {
        const onChange = vi.fn();
        render(<Harness paidFeatures="upsell" facts={slots(FULL)} onChange={onChange} />);

        expect(screen.getByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();

        fireEvent.click(radio(v.private));

        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).getAttribute('aria-checked')).toBe('true');
    });

    it('the refusal offers three ways forward - make one public, delete one, take Premium - each described', () => {
        render(<Harness paidFeatures="upsell" facts={slots(FULL)} />);

        // The title names the ways (a heading, not a labelled group: nativeContainerNames.md N1), and they are the only buttons.
        expect(screen.getByRole('heading', { name: v.waysTitle })).toBeTruthy();
        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
            `${v.wayMakePublic}${v.wayMakePublicDetail}`,
            `${v.wayDelete}${v.wayDeleteDetail}`,
            `${v.wayPremium}${v.wayPremiumDetail}`,
        ]);
    });

    it('"Make a private recipe public" and "Delete a private recipe" both take the cook to their recipes; Premium opens the upsell', () => {
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

        fireEvent.click(screen.getByRole('button', { name: new RegExp(v.wayMakePublic, 'u') }));
        fireEvent.click(screen.getByRole('button', { name: new RegExp(v.wayDelete, 'u') }));
        expect(onFreeASlot).toHaveBeenCalledTimes(2);
        expect(onPremiumRequired).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: new RegExp(v.wayPremium, 'u') }));
        expect(onPremiumRequired).toHaveBeenCalledTimes(1);
    });

    it.each(['hidden', 'loading'] as const)('⛔ offers no Premium way when paid features are %s', (state) => {
        render(<Harness paidFeatures={state} facts={slots(FULL, state)} />);

        expect(screen.queryByRole('button', { name: new RegExp(v.wayPremium, 'u') })).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('a recipe already private shows no refusal and no ways, even with every slot used: it holds its own', () => {
        render(<Harness initial={PRIVATE_DRAFT} paidFeatures="upsell" facts={slots(FULL)} />);

        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');
        expect(screen.queryByRole('heading', { name: v.waysTitle })).toBeNull();
    });

    it('⛔ a private recipe made public says it frees a slot, and asks to confirm first', () => {
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

        expect(screen.getByText(v.publicFrees)).toBeTruthy();

        fireEvent.click(radio(v.public));

        expect(onConfirmPublic).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });
});
