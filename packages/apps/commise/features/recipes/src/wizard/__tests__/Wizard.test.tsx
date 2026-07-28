// @vitest-environment jsdom
/**
 * Component tests for the web `Wizard` compound shell (w3/e1,e2; U6 chrome remediation). A small harness owns
 * `step`/`values` the way `useRecipeEditor` would (using the SAME pure `canAdvanceFromStep`/`stepErrorsFor`
 * the real hook calls), so `goNext`'s validity gate and the rail's invalid-flagging behave exactly as they
 * would wired to the real hook, without needing the hook's network/query machinery.
 *
 * **U6 chrome model (what these tests pin down):** the footer (`Wizard.Controls`) is the ONE contextual
 * primary — a filled `Next: {name}` on steps 1–3 and a filled `Publish` on step 4 (Publish is NO LONGER live
 * on steps 1–3), with a secondary `Prev` on the left for every step past the first. The header
 * (`Wizard.TopBar`) keeps `Preview` as its own icon button and demotes `Save Draft` + `Cancel` into an
 * overflow ("More actions") menu, so it NEVER packs four filled buttons and Publish is gone from it entirely.
 * Everything else — the discard guard, the preview panel, the rail, attempted-set marking — is preserved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { utilityContrast } from '@commise/test-utils';

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
            <Wizard.Rail />
            <Wizard.TopBar />
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
                <p>Photos step body</p>
            </Wizard.Step>
            <Wizard.Controls />
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
        expect(screen.queryByText('Photos step body')).toBeFalsy();
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
        expect(screen.getByRole('button', { name: /Basic: needs attention/ })).toBeTruthy();
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

        expect(screen.getByRole('button', { name: /Basic: completed/ })).toBeTruthy();
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
        await user.click(screen.getByRole('button', { name: /Photos: not yet started/ }));
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
        expect(screen.getByRole('button', { name: 'Next: Photos' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /[<>]/ })).toBeFalsy();
    });
});

describe('Wizard (web) — footer is the ONE contextual primary (U6)', () => {
    it('shows a FILLED Next primary — and NO Publish — on step 1', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        const next = screen.getByRole('button', { name: /Next: Ingredients/ });
        // Filled == the Button primitive's primary tier (gradient surface), not a bordered secondary.
        expect(next.className).toContain('from-seafoam');
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeFalsy();
    });

    it('shows a FILLED Next primary — and NO Publish — on step 3', () => {
        render(<Harness initialValues={validValues()} initialStep={3} />);

        expect(screen.getByRole('button', { name: /Next: Photos/ }).className).toContain('from-seafoam');
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeFalsy();
    });

    it('swaps the footer primary to a FILLED Publish — and NO Next — on step 4', () => {
        render(<Harness initialValues={validValues()} initialStep={4} />);

        const publish = screen.getByRole('button', { name: 'Publish' });
        expect(publish.className).toContain('from-seafoam');
        expect(screen.queryByRole('button', { name: /^Next:/ })).toBeFalsy();
    });

    it('hides Prev on step 1 and shows it (secondary) once past the first step', () => {
        const { unmount } = render(<Harness initialValues={validValues()} initialStep={1} />);
        expect(screen.queryByRole('button', { name: /^Prev:/ })).toBeFalsy();
        unmount();

        render(<Harness initialValues={validValues()} initialStep={2} />);
        const prev = screen.getByRole('button', { name: 'Prev: Basic' });
        // Secondary tier == the coral-outlined glass surface, never the filled seafoam primary (there is only
        // ONE filled primary in the footer, and this control must not be it).
        expect(prev.className).toContain('border-coral');
        expect(prev.className).not.toContain('from-seafoam');
    });

    it('Next in the footer advances the step; Publish in the footer calls publish', async () => {
        const user = userEvent.setup();
        const onPublish = vi.fn();
        render(<Harness initialValues={validValues()} initialStep={4} onPublish={onPublish} />);

        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });
});

describe('Wizard (web) — header overflow menu (U6: Save Draft + Cancel demoted)', () => {
    it('never renders four filled action buttons in the header — only Preview + the overflow trigger', () => {
        render(<Harness />);

        const toolbar = screen.getByRole('toolbar', { name: 'Recipe wizard actions' });
        // Exactly two controls in the header chrome: Preview and the "More actions" overflow trigger. The
        // four-filled-button wrap that U6 removes can never recur while this count holds.
        expect(within(toolbar).getAllByRole('button')).toHaveLength(2);
        // Publish is gone from the header entirely — it now lives in the footer as the step-4 primary.
        expect(within(toolbar).queryByRole('button', { name: 'Publish' })).toBeFalsy();
        // Save Draft + Cancel are NOT surfaced until the overflow menu is opened.
        expect(screen.queryByRole('menuitem', { name: 'Save Draft' })).toBeFalsy();
        expect(screen.queryByRole('menuitem', { name: 'Cancel' })).toBeFalsy();
    });

    it('discloses Save Draft + Cancel from the overflow menu, and Save Draft calls the given action', async () => {
        const user = userEvent.setup();
        const onSaveDraft = vi.fn();
        render(<Harness onSaveDraft={onSaveDraft} />);

        await openActionsMenu(user);

        expect(screen.getByRole('menu', { name: 'More actions' })).toBeTruthy();
        await user.click(screen.getByRole('menuitem', { name: 'Save Draft' }));

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it('closes the overflow menu on Escape without invoking anything', async () => {
        const user = userEvent.setup();
        const onSaveDraft = vi.fn();
        render(<Harness onSaveDraft={onSaveDraft} />);

        await openActionsMenu(user);
        expect(screen.getByRole('menu', { name: 'More actions' })).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu', { name: 'More actions' })).toBeFalsy();
        expect(onSaveDraft).not.toHaveBeenCalled();
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
        expect(screen.getByText('Photos step body')).toBeTruthy();
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

        await user.click(screen.getByRole('button', { name: /Basic:/ }));

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

describe('Wizard (web) — Preview', () => {
    it('shows the current draft values and can be closed', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));

        const preview = screen.getByRole('dialog', { name: 'Preview' });
        expect(within(preview).getByText('Herb Risotto')).toBeTruthy();
        expect(within(preview).getByText('4')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Close preview' }));
        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeFalsy();
    });

    it('caps the preview panel height and scrolls its body so it fits a short viewport (U5)', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));

        // On a short 360px-tall device the centered panel could exceed the viewport; capping the CARD at
        // `max-h-[85vh]` with `overflow-y-auto` keeps it on-screen and scrollable. The card is the dialog's
        // content child (the dialog element itself is the backdrop). Desktop is unaffected — the short preview
        // never reaches 85vh there.
        const card = screen.getByRole('dialog', { name: 'Preview' }).firstElementChild as HTMLElement;
        expect(card.className).toContain('max-h-[85vh]');
        expect(card.className).toContain('overflow-y-auto');
    });

    // Minor a11y gap (opus review): the hand-rolled preview dialog previously had no Escape/backdrop
    // dismissal, unlike the Radix ConfirmDialog rendered in the same file.
    it('closes on Escape', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));
        expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeFalsy();
    });

    it('closes on a backdrop click, but NOT on a click inside the panel card', async () => {
        const user = userEvent.setup();
        render(<Harness initialValues={validValues()} />);

        await user.click(screen.getByRole('button', { name: 'Preview' }));
        const preview = screen.getByRole('dialog', { name: 'Preview' });

        // A click on content INSIDE the card must not dismiss the panel.
        await user.click(within(preview).getByText('Herb Risotto'));
        expect(screen.getByRole('dialog', { name: 'Preview' })).toBeTruthy();

        // A click on the backdrop itself (the dialog element, outside the card) dismisses it.
        await user.click(preview);
        expect(screen.queryByRole('dialog', { name: 'Preview' })).toBeFalsy();
    });
});
