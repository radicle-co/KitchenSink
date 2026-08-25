// @vitest-environment jsdom
/**
 * Component tests for the web `Wizard` compound shell (w3/e1,e2; U6 chrome remediation). A small harness owns
 * `step`/`values` the way `useRecipeEditor` would (using the SAME pure `canAdvanceFromStep`/`stepErrorsFor`
 * the real hook calls), so `goNext`'s validity gate and the rail's invalid-flagging behave exactly as they
 * would wired to the real hook, without needing the hook's network/query machinery.
 *
 * **U32/U33 chrome model (what these tests pin down):**
 *  - `Wizard.Controls` is the ACTION BAR — `Previous · Save Draft · Next`, with `Publish` in Next's slot on
 *    the last step. It is rendered ONCE, by `Wizard.Header`, and its `position` (not its existence) is what
 *    the `lg` breakpoint changes: `fixed inset-x-0 bottom-0` below `lg`, `static` in the header band above.
 *    The class contract is asserted here; the real behaviour at real viewports is Playwright's
 *    (`recipeEditWizard.spec.ts`), because jsdom loads no CSS and cannot tell a pinned bar from a scrolled one.
 *  - `Wizard.Header` carries the BACK affordance (below `lg`; it routes through the discard guard) and the
 *    overflow menu (above `lg`; Save Draft + Cancel).
 *  - `Preview` is DELETED, replaced by the Review step body. Its old describe block is gone with it — the
 *    coverage moved to `form/__tests__/RecipeReviewFields.test.tsx`, which tests the surface that replaced it.
 * Everything else — the discard guard, the rail, attempted-set marking, the blocked-advance notice — is
 * preserved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '../../form/model.js';
import { Wizard } from '../Wizard.js';

afterEach(cleanup);

const validValues = (): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb Risotto',
    servings: 4,
    ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' }],
    steps: [{ instruction: 'Toast the rice.' }],
});

interface HarnessProps {
    readonly initialValues?: RecipeFormValues;
    readonly initialStep?: RecipeWizardStep;
    readonly mode?: 'create' | 'edit';
    readonly isDirty?: boolean;
    readonly submitting?: boolean;
    readonly onCancel?: () => void;
    readonly onSaveDraft?: () => void;
    readonly onPublish?: () => void;
}

/** A minimal stand-in for `useRecipeEditor`'s step/value contract, driven by the SAME pure validators. */
const Harness: FC<HarnessProps> = ({
    initialValues = defaultRecipeFormValues(),
    initialStep = 1,
    mode = 'create',
    isDirty = false,
    submitting = false,
    onCancel = vi.fn(),
    onSaveDraft = vi.fn(),
    onPublish = vi.fn(),
}) => {
    const [values, setValues] = useState(initialValues);
    const [step, setStep] = useState<RecipeWizardStep>(initialStep);

    return (
        <Wizard
            mode={mode}
            step={step}
            values={values}
            canAdvanceFrom={(s) => canAdvanceFromStep(values, s)}
            stepErrors={(s) => stepErrorsFor(values, s)}
            goNext={() => {
                if (step < 4 && canAdvanceFromStep(values, step)) {
                    setStep((step + 1) as RecipeWizardStep);
                }
            }}
            goPrev={() => {
                if (step > 1) {
                    setStep((step - 1) as RecipeWizardStep);
                }
            }}
            goToStep={setStep}
            saveDraft={onSaveDraft}
            publish={onPublish}
            onCancel={onCancel}
            isDirty={isDirty}
            submitting={submitting}
        >
            <Wizard.Header />
            <Wizard.Rail />
            <Wizard.Step step={1}>
                <input
                    aria-label="Title"
                    value={values.title}
                    onChange={(e) => setValues({ ...values, title: e.target.value })}
                />
            </Wizard.Step>
            <Wizard.Step step={2}>
                <p>Ingredients step body</p>
            </Wizard.Step>
            <Wizard.Step step={3}>
                <p>Instructions step body</p>
            </Wizard.Step>
            <Wizard.Step step={4}>
                <p>Review step body</p>
            </Wizard.Step>
            {/* ⛔ No <Wizard.Controls /> here — `Wizard.Header` places the action bar itself (U32). A second
                placement would ship two bars carrying the same accessible names, which is exactly what the
                "renders exactly one of each action control" test below exists to catch. */}
        </Wizard>
    );
};

/** Open the header's overflow ("More actions") menu, disclosing the Save Draft / Cancel items. */
const openActionsMenu = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await user.click(screen.getByRole('button', { name: 'More actions' }));
};

describe('Wizard (web) — Wizard.Step gating', () => {
    it('renders only the active step body', () => {
        render(<Harness initialStep={1} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.queryByText('Instructions step body')).toBeFalsy();
        expect(screen.queryByText('Review step body')).toBeFalsy();
    });

    it('switches which step body renders when the step changes', () => {
        render(<Harness initialStep={3} />);

        expect(screen.queryByLabelText('Title')).toBeFalsy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();
    });
});

describe('Wizard (web) — Next gating + rail invalidity', () => {
    it('Next does not advance while the current step is invalid, and flags that step in the rail', async () => {
        const user = userEvent.setup();
        // Blank title -> step 1 invalid (validateRecipeForm requires a non-blank title).
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        // Still on step 1 — the step body did not change.
        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        // The rail flags step 1 as needing attention now that it was attempted.
        expect(screen.getByRole('button', { name: /Details: needs attention/ })).toBeTruthy();
    });

    it('Next advances to the following step when the current step is valid', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        expect(screen.getByText('Ingredients step body')).toBeTruthy();
    });

    it('does not flag an unattempted step invalid merely because it currently has errors', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        // Step 2 (ingredients) is empty/invalid too, but has never been attempted — not flagged.
        expect(screen.getByRole('button', { name: /Ingredients: not yet started/ })).toBeTruthy();
    });

    it('the rail shows a completed step behind the current one', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        expect(screen.getByRole('button', { name: /Details: completed/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Ingredients: current step/ })).toBeTruthy();
    });
});

describe('Wizard (web) — a refused Next says WHY (the footer blocked-advance notice)', () => {
    // Mirrors the native spec exactly. `Next` is always enabled and `goNext` no-ops on an invalid step, so
    // before this notice the ONLY feedback was the rail marker turning `invalid` — on a step whose body is
    // one empty list, the primary control did nothing and said nothing.
    const noIngredients = (): RecipeFormValues => ({ ...validValues(), ingredients: [] });

    it('says nothing before the author has tried to advance', () => {
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        expect(screen.queryByText('Add at least one ingredient.')).toBeFalsy();
    });

    it('names the blocking rule once Next is refused', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        await user.click(screen.getByRole('button', { name: /Next: Instructions/ }));

        expect(screen.getByText('Add at least one ingredient.')).toBeTruthy();
    });

    it('announces it as an alert, so a screen reader hears the refusal it cannot see', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        await user.click(screen.getByRole('button', { name: /Next: Instructions/ }));

        expect(within(screen.getByRole('alert')).getByText('Add at least one ingredient.')).toBeTruthy();
    });

    it('lists every distinct blocking rule of a step with several invalid fields', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={{ ...defaultRecipeFormValues(), servings: 0 }} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        expect(screen.getByText('A title is required.')).toBeTruthy();
        expect(screen.getByText('Servings must be greater than zero.')).toBeTruthy();
    });

    it('clears once the step is satisfied and Next actually advances', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));
        expect(screen.getByText('A title is required.')).toBeTruthy();

        await user.type(screen.getByLabelText('Title'), 'Herb Risotto');

        expect(screen.queryByText('A title is required.')).toBeFalsy();
    });

    it('says nothing on a valid step that was attempted and advanced through', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={1} />);

        await user.click(screen.getByRole('button', { name: /Next: Ingredients/ }));

        expect(screen.queryByRole('alert')).toBeFalsy();
    });

    it('stays silent for a refused PUBLISH — the container renders those errors inline, and one refusal must not be voiced twice', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={noIngredients()} initialStep={4} />);

        await user.click(screen.getByRole('button', { name: /Publish/ }));

        // The rail still flags the offending step (whole-form validation ran)…
        expect(screen.getByRole('button', { name: /Ingredients: needs attention/ })).toBeTruthy();
        // …but the footer says nothing: `errors` is the container's channel for a failed Publish.
        expect(screen.queryByRole('alert')).toBeFalsy();
    });

    it('drops a pending refusal once the author presses Publish instead', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        await user.click(screen.getByRole('button', { name: /Next: Instructions/ }));
        expect(screen.getByText('Add at least one ingredient.')).toBeTruthy();

        // Jump to step 4 via the rail (free navigation) and publish from its footer.
        await user.click(screen.getByRole('button', { name: /Review: not yet started/ }));
        await user.click(screen.getByRole('button', { name: /Publish/ }));

        // Back on the blocked step, the stale refusal is gone — Publish owns the feedback now.
        await user.click(screen.getByRole('button', { name: /Ingredients: needs attention/ }));

        expect(screen.queryByRole('alert')).toBeFalsy();
    });
});

describe('Wizard (web) — the footer nav labels carry NO decorative chevron', () => {
    // Mirrors the native spec: the footer buttons already render a chevron ICON, so a `<`/`>` inside the
    // SHARED localized label (`wizard/messages.ts`, no `.native` variant) duplicates it visually and makes a
    // screen reader announce "Next: Ingredients greater-than". Asserted as an EXACT accessible name — the
    // loose `/Next: …/` regexes used elsewhere in this file still match `Next: Ingredients >`.
    it('names the Next primary exactly, with no chevron glyph in the accessible name', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.getByRole('button', { name: 'Next: Ingredients' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /[<>]/ })).toBeFalsy();
    });

    it('names the Prev secondary exactly, with no chevron glyph in the accessible name', () => {
        render(<Harness initialValues={validValues()} initialStep={3} />);

        expect(screen.getByRole('button', { name: 'Prev: Ingredients' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Next: Review' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /[<>]/ })).toBeFalsy();
    });
});

describe('Wizard (web) — the action bar carries Previous · Save Draft · Next (U32)', () => {
    it('shows a FILLED Next primary — and NO Publish — on step 1', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.getByRole('button', { name: 'Next: Ingredients' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    });

    it('shows a FILLED Next primary — and NO Publish — on step 3', () => {
        render(<Harness initialValues={validValues()} initialStep={3} />);

        expect(screen.getByRole('button', { name: 'Next: Review' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    });

    it('swaps the primary to a FILLED Publish — and NO Next — on the Review step', () => {
        render(<Harness initialValues={validValues()} initialStep={4} />);

        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Next: / })).toBeNull();
    });

    it('hides Previous on step 1 and shows it once past the first step', async () => {
        // Drives the REAL advance rather than re-rendering with a different `initialStep` — that prop seeds
        // state once, so a rerender would silently assert nothing about navigation at all.
        const user = userEvent.setup();

        render(<Harness initialValues={validValues()} initialStep={1} />);
        expect(screen.queryByRole('button', { name: /^Prev: / })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Next: Ingredients' }));

        expect(screen.getByRole('button', { name: 'Prev: Details' })).toBeTruthy();
    });

    it('carries Save Draft as a FIRST-CLASS control on every step, not an overflow item', () => {
        // U32's substantive change for a phone user: Save Draft used to be reachable only by opening a kebab.
        for (const step of [1, 2, 3, 4] as const) {
            cleanup();
            render(<Harness initialValues={validValues()} initialStep={step} />);

            expect(screen.getByRole('button', { name: 'Save Draft' })).toBeTruthy();
        }
    });

    it('renders exactly ONE of each action control — the bar is placed once, not once per breakpoint', () => {
        // ⛔ The regression this catches: rendering the bar twice (one copy hidden per breakpoint) gives every
        // control two identical accessible names, so a screen reader's control list — and every `getByRole`
        // here and in Playwright — finds two. jsdom loads no CSS, so a `hidden` copy would be fully visible
        // to this query; that is precisely why the single-element design is the one that is testable.
        render(<Harness initialValues={validValues()} initialStep={2} />);

        expect(screen.getAllByRole('button', { name: 'Save Draft' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Next: Instructions' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Prev: Details' })).toHaveLength(1);
    });

    it('Next advances the step; Publish calls publish; Save Draft calls saveDraft', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        const onSaveDraft = vi.fn();

        render(
            <Harness initialValues={validValues()} initialStep={3} onPublish={onPublish} onSaveDraft={onSaveDraft} />,
        );

        await user.click(screen.getByRole('button', { name: 'Save Draft' }));
        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        expect(onPublish).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Next: Review' }));
        expect(screen.getByText('Review step body')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Publish' }));
        expect(onPublish).toHaveBeenCalledTimes(1);
    });
});

describe('Wizard (web) — the bar is PINNED below `lg`, and in the header band above it (U32)', () => {
    const barOf = (): HTMLElement => {
        const region = screen.getByLabelText('Wizard step navigation');
        const bar = region.parentElement;

        if (bar === null) {
            throw new Error('the action-bar region has no wrapper to carry the positioning classes');
        }

        return bar;
    };

    it('is `fixed` to the bottom of the VIEWPORT below `lg`, not sticky inside a scroll container', () => {
        // ⛔ This is the shipped-defect fix, stated as a class contract. `position: fixed` is outside every
        // scroll container BY CONSTRUCTION; the mockup's `sticky bottom-0` only pins because of one exact
        // flex structure and drifts back into flow the moment that structure changes.
        render(<Harness initialValues={validValues()} initialStep={2} />);
        const bar = barOf();

        expect(bar.className).toContain('fixed');
        expect(bar.className).toContain('bottom-0');
        expect(bar.className).toContain('inset-x-0');
        expect(bar.className).not.toContain('sticky');
    });

    it('clears the gesture bar with `env(safe-area-inset-bottom)`', () => {
        render(<Harness initialValues={validValues()} initialStep={2} />);

        expect(barOf().className).toContain('env(safe-area-inset-bottom)');
    });

    it('returns to the flow — inside the sticky header band — at `lg` and above', () => {
        render(<Harness initialValues={validValues()} initialStep={2} />);
        const bar = barOf();

        expect(bar.className).toContain('lg:static');

        const header = screen.getByRole('toolbar', { name: 'Recipe wizard actions' });

        expect(header.contains(bar)).toBe(true);
        expect(header.className).toContain('sticky');
    });
});

describe('Wizard (web) — the header: a back arrow below `lg`, the overflow menu above it (U32)', () => {
    it('renders a localized BACK affordance, and it is hidden at `lg` and above', () => {
        render(<Harness initialValues={validValues()} />);
        const back = screen.getByRole('button', { name: 'Back' });

        expect(back.className).toContain('lg:hidden');
    });

    it('routes the back arrow THROUGH the discard guard, never around it', async () => {
        // ⛔ The arrow replaced the overflow menu's `Cancel`, so it must inherit `Cancel`'s guard exactly. A
        // back arrow wired to history (or straight to `onCancel`) would silently discard unsaved work.
        const user = userEvent.setup();
        const onCancel = vi.fn();

        render(<Harness initialValues={validValues()} isDirty onCancel={onCancel} />);
        await user.click(screen.getByRole('button', { name: 'Back' }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('leaves the back arrow a straight exit when there is nothing unsaved to lose', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();

        render(<Harness initialValues={validValues()} isDirty={false} onCancel={onCancel} />);
        await user.click(screen.getByRole('button', { name: 'Back' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('keeps the overflow menu for `lg` and above ONLY — below it, both its items have moved out', () => {
        render(<Harness initialValues={validValues()} />);
        const trigger = screen.getByRole('button', { name: 'More actions' });
        const wrapper = trigger.closest('div.hidden');

        expect(wrapper).not.toBeNull();
        expect(wrapper?.className).toContain('lg:flex');
    });

    it('discloses Save Draft + Cancel from the overflow menu, and Cancel still routes through the guard', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();

        render(<Harness initialValues={validValues()} isDirty onCancel={onCancel} />);
        await openActionsMenu(user);

        const menu = screen.getByRole('menu', { name: 'More actions' });

        expect(within(menu).getByRole('menuitem', { name: 'Save Draft' })).toBeTruthy();

        await user.click(within(menu).getByRole('menuitem', { name: 'Cancel' }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();
    });

    it('no longer offers a Preview affordance anywhere — Review replaced it (U33)', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeNull();
    });

    it('closes the overflow menu on Escape without invoking anything', async () => {
        const user = userEvent.setup();
        const onSaveDraft = vi.fn();
        const onCancel = vi.fn();

        render(<Harness initialValues={validValues()} onSaveDraft={onSaveDraft} onCancel={onCancel} />);
        await openActionsMenu(user);
        expect(screen.getByRole('menu', { name: 'More actions' })).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu', { name: 'More actions' })).toBeNull();
        expect(onSaveDraft).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});

describe('Wizard (web) — Publish validation (from the footer on step 4)', () => {
    it('Publish calls the given action and carries the "Publish" accessible name in create mode (w3/e7)', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        render(<Harness mode="create" initialValues={validValues()} initialStep={4} onPublish={onPublish} />);

        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });

    it('Publish carries the SAME "Publish" accessible name in edit mode (w3/e7: label matches behavior, not mode)', () => {
        render(<Harness mode="edit" initialValues={validValues()} initialStep={4} />);

        expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    });

    it('Publish while another step is invalid flags that OTHER step in the rail (no navigation occurs)', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        // Step 1 is valid; steps 2/3 (ingredients/instructions) are still empty/invalid. Publish lives on step 4.
        const partial: RecipeFormValues = { ...defaultRecipeFormValues(), title: 'Herb Risotto', servings: 4 };
        render(<Harness initialValues={partial} initialStep={4} onPublish={onPublish} />);

        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(onPublish).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: /Ingredients: needs attention/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Instructions: needs attention/ })).toBeTruthy();
        // Still on step 4 — this shell never navigates on Publish; that is the hook's job.
        expect(screen.getByText('Review step body')).toBeTruthy();
    });
});

describe('Wizard (web) — submitting busies the write actions', () => {
    it('busies (disables) the footer Publish primary while a save is in flight', () => {
        render(<Harness initialValues={validValues()} initialStep={4} submitting />);

        const publish = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
        expect(publish.disabled).toBe(true);
        expect(publish.getAttribute('aria-busy')).toBe('true');
    });

    it('busies (disables) the overflow Save Draft item while a save is in flight', async () => {
        const user = userEvent.setup();
        render(<Harness submitting />);

        await openActionsMenu(user);

        const saveDraft = screen.getByRole('menuitem', { name: 'Save Draft' }) as HTMLButtonElement;
        expect(saveDraft.disabled).toBe(true);
    });
});

describe('Wizard (web) — discard guard (Cancel now lives in the overflow menu)', () => {
    it('Cancel with no unsaved edits calls onCancel immediately (no dialog)', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<Harness isDirty={false} onCancel={onCancel} />);

        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alertdialog')).toBeFalsy();
    });

    it('Cancel with unsaved edits shows the discard dialog; confirming discards (calls onCancel)', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Cancel with unsaved edits: choosing "Keep editing" dismisses the dialog without discarding', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        await openActionsMenu(user);
        await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog')).toBeFalsy();
    });

    it('backward rail navigation with unsaved edits is guarded too', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} initialStep={3} isDirty />);

        await user.click(screen.getByRole('button', { name: /Details:/ }));

        expect(screen.getByRole('alertdialog')).toBeTruthy();
        // Still on step 3 until confirmed.
        expect(screen.getByText('Instructions step body')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });
});

describe('Wizard (web) — chrome landmark labels (a11y, localized, not shared)', () => {
    it('gives the rail nav and the top-bar toolbar their OWN distinct localized accessible names', () => {
        render(<Harness />);

        expect(screen.getByRole('navigation', { name: 'Recipe wizard steps' })).toBeTruthy();
        expect(screen.getByRole('toolbar', { name: 'Recipe wizard actions' })).toBeTruthy();
    });

    it('names the overflow trigger and the disclosed menu with a localized label (not a raw literal)', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
        await openActionsMenu(user);
        expect(screen.getByRole('menu', { name: 'More actions' })).toBeTruthy();
    });

    it('gives the footer step-navigation region a localized accessible name (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Wizard step navigation')).toBeTruthy();
    });
});

/**
 * Cross-platform parity for the native leaf's step-rail fix (the Maestro dump where step 4 rendered clipped
 * at the 1080px screen edge, because the native rail laid its four pills out on one horizontally scrolling
 * line). This leaf was already the SAFE one — `flex-wrap` puts an overflowing pill on the next line — so
 * these assertions pin the wrap the native leaf has now adopted, plus the same shrink contract: a pill may
 * yield width and break its label, its number badge may not. Keeps the two leaves' overflow behaviour from
 * drifting again (`li`'s `min-width: auto` still lets a single long token overflow otherwise).
 */
describe('Wizard (web) — the step rail cannot push a step off the screen edge', () => {
    const pill = (): HTMLElement => screen.getByRole('button', { name: /Instructions:/ });

    it('wraps the pill row instead of laying the four pills out on one over-wide line', () => {
        render(<Harness />);

        const row = pill().parentElement?.parentElement;

        expect(row?.tagName).toBe('OL');
        expect(row?.className).toContain('flex-wrap');
    });

    it('lets a pill shrink and break its label rather than overflow the row', () => {
        render(<Harness />);

        expect(pill().parentElement?.className).toContain('min-w-0');
        expect(within(pill()).getByText('Instructions').className).toContain('break-words');
    });

    it('never shrinks the step marker itself', () => {
        render(<Harness />);

        expect((pill().firstElementChild as HTMLElement).className).toContain('shrink-0');
    });
});

/**
 * The rail marker's NUMERAL is text a reader reads to know which step they are on, so it is bound by SC 1.4.3
 * (4.5:1) — `text-caption` is 12px, nowhere near the large-text exemption. Measured off the marker element's
 * REAL rendered class list (the marker class is a lookup table, so asserting the constant would prove nothing
 * about what rendered), with the marker's own `bg-*` composited. See the palette JSDoc in `@commise/ui`'s
 * `tokens/colors.ts` for when seafoam remains the right token — the marker's `border-seafoam` is one such
 * non-text site and is deliberately untouched.
 */
describe('Wizard (web) — WCAG AA rail-marker contrast (SC 1.4.3)', () => {
    it('the current step’s marker numeral is legible on the marker’s own fill', () => {
        render(<Harness initialStep={2} />);

        const marker = screen.getByRole('button', { name: /Ingredients: current step/ })
            .firstElementChild as HTMLElement;

        expect(
            utilityContrast(marker.className),
            'current step’s rail-marker numeral, on the marker’s own fill',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The wizard's top bar sits on the app background (the shell paints no card behind it), so that is the surface
 * the "More actions" trigger's focus ring is drawn on — a Tailwind ring is a spread box-shadow OUTSIDE the
 * border box, so the trigger's own white fill is not what the ring is seen against.
 *
 * The ring shipped as `ring-seafoam-light` (2.58:1), under the 3:1 SC 1.4.11 floor (#114). This trigger is the
 * ONLY route to Save Draft and Cancel since U6 demoted them into the overflow menu, and it is an icon-only
 * control with `outline-none` — so a keyboard viewer who cannot see the ring cannot find the menu at all.
 */
describe('Wizard (web) — the overflow trigger’s focus ring clears the 3:1 SC 1.4.11 floor', () => {
    it('rings the "More actions" trigger legibly against the page it sits on', () => {
        render(<Harness />);

        const trigger = screen.getByRole('button', { name: 'More actions' });

        expect(trigger.className, 'the browser outline is suppressed, so the ring is the whole indicator') //
            .toContain('outline-none');
        expect(ringContrast(trigger.className, { surface: semantic.background }), 'overflow-trigger focus ring') //
            .toBeGreaterThanOrEqual(3);
    });

    it('out-measures the `seafoam-light` it replaced', () => {
        render(<Harness />);

        expect(
            ringContrast(screen.getByRole('button', { name: 'More actions' }).className, {
                surface: semantic.background,
            }),
        ).toBeGreaterThan(ringContrast('ring-2 ring-seafoam-light', { surface: semantic.background }));
    });
});
