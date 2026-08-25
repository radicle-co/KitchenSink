/**
 * Component tests for the native `Wizard` compound shell (w3/e1,e2; U32/U33) — mirrors `Wizard.test.tsx`'s
 * harness and coverage against the RN leaf, run through react-native-web under jsdom per this package's
 * native test convention.
 *
 * **U32/U33 chrome model (mirrored from the web spec):**
 *  - `Wizard.Controls` is the ACTION BAR — `Previous / Save Draft / Next`, `Publish` in Next's slot on the
 *    last step. `Save Draft` is a first-class control here; it is no longer an overflow item.
 *  - `Wizard.Header` is NEW: a BACK affordance (routed through the discard guard) plus the step's name as a
 *    heading, on a surface that previously rendered bare.
 *  - There is NO overflow menu on native at all — see the leaf's own doc. The `aria-expanded` and busy-item
 *    coverage the deleted menu carried MOVED: the disclosure's expanded-state assertions now live in the web
 *    spec (`Wizard.test.tsx`, "the header" describe), which is the only platform that still renders a kebab,
 *    and the busy assertion moved onto the bar's own `Save Draft` control below.
 *  - `Preview` is DELETED; step 4 is Review. Its assertions are gone with it, and the surface that replaced
 *    it is covered by `form/__tests__/RecipeReviewFields.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type FC } from 'react';
import { Text, TextInput } from 'react-native';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '../../form/model.js';
import { Wizard } from '../Wizard.native.js';

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
                <TextInput
                    accessibilityLabel="Title"
                    value={values.title}
                    onChangeText={(t) => setValues({ ...values, title: t })}
                />
            </Wizard.Step>
            <Wizard.Step step={2}>
                <Text>Ingredients step body</Text>
            </Wizard.Step>
            <Wizard.Step step={3}>
                <Text>Instructions step body</Text>
            </Wizard.Step>
            <Wizard.Step step={4}>
                <Text>Review step body</Text>
            </Wizard.Step>
            <Wizard.Controls />
        </Wizard>
    );
};

describe('Wizard (native) — Wizard.Step gating', () => {
    it('renders only the active step body', () => {
        render(<Harness initialStep={1} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.queryByText('Review step body')).toBeFalsy();
    });

    it('switches which step body renders when the step changes', () => {
        render(<Harness initialStep={3} />);

        expect(screen.queryByLabelText('Title')).toBeFalsy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();
    });
});

describe('Wizard (native) — Next gating + rail invalidity', () => {
    it('Next does not advance while the current step is invalid, and flags that step in the rail', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.getByLabelText(/Details: needs attention/)).toBeTruthy();
    });

    it('Next advances to the following step when the current step is valid', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByText('Ingredients step body')).toBeTruthy();
    });

    it('does not flag an unattempted step invalid merely because it currently has errors', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        expect(screen.getByLabelText(/Ingredients: not yet started/)).toBeTruthy();
    });

    it('the rail shows a completed step behind the current one', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByLabelText(/Details: completed/)).toBeTruthy();
        expect(screen.getByLabelText(/Ingredients: current step/)).toBeTruthy();
    });
});

describe('Wizard (native) — a refused Next says WHY (the footer blocked-advance notice)', () => {
    // `Next` is always enabled and `goNext` no-ops on an invalid step. Before this notice the only feedback
    // was the rail marker turning `invalid`, so on step 2 — whose whole body is an empty ingredient list —
    // the primary control did nothing and said nothing. Maestro's `recipes/photos` flow burned a round on
    // exactly that: it tapped `Next: Instructions` on a seeded recipe with no ingredients and the screen
    // simply did not move.
    const noIngredients = (): RecipeFormValues => ({ ...validValues(), ingredients: [] });

    it('says nothing before the author has tried to advance', () => {
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        expect(screen.queryByText('Add at least one ingredient.')).toBeFalsy();
    });

    it('names the blocking rule once Next is refused', () => {
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        fireEvent.click(screen.getByLabelText(/Next: Instructions/));

        expect(screen.getByText('Add at least one ingredient.')).toBeTruthy();
    });

    it('announces it as an alert, so a screen reader hears the refusal it cannot see', () => {
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        fireEvent.click(screen.getByLabelText(/Next: Instructions/));

        expect(within(screen.getByRole('alert')).getByText('Add at least one ingredient.')).toBeTruthy();
    });

    it('lists every distinct blocking rule of a step with several invalid fields', () => {
        render(<Harness initialValues={{ ...defaultRecipeFormValues(), servings: 0 }} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.getByText('A title is required.')).toBeTruthy();
        expect(screen.getByText('Servings must be greater than zero.')).toBeTruthy();
    });

    it('clears once the step is satisfied and Next actually advances', () => {
        render(<Harness initialValues={defaultRecipeFormValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));
        expect(screen.getByText('A title is required.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Herb Risotto' } });

        expect(screen.queryByText('A title is required.')).toBeFalsy();
    });

    it('says nothing on a valid step that was attempted and advanced through', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        fireEvent.click(screen.getByLabelText(/Next: Ingredients/));

        expect(screen.queryByRole('alert')).toBeFalsy();
    });

    it('stays silent for a refused PUBLISH — the container renders those errors inline, and one refusal must not be voiced twice', () => {
        render(<Harness initialValues={noIngredients()} initialStep={4} />);

        fireEvent.click(screen.getByLabelText(/Publish/));

        // The rail still flags the offending step (whole-form validation ran)…
        expect(screen.getByLabelText(/Ingredients: needs attention/)).toBeTruthy();
        // …but the footer says nothing: `errors` is the container's channel for a failed Publish.
        expect(screen.queryByRole('alert')).toBeFalsy();
    });

    it('drops a pending refusal once the author presses Publish instead', () => {
        render(<Harness initialValues={noIngredients()} initialStep={2} />);

        fireEvent.click(screen.getByLabelText(/Next: Instructions/));
        expect(screen.getByText('Add at least one ingredient.')).toBeTruthy();

        // Jump to step 4 via the rail (free navigation) and publish from its footer.
        fireEvent.click(screen.getByLabelText(/Review: not yet started/));
        fireEvent.click(screen.getByLabelText(/Publish/));

        // Back on the blocked step, the stale refusal is gone — Publish owns the feedback now.
        fireEvent.click(screen.getByLabelText(/Ingredients: needs attention/));

        expect(screen.queryByRole('alert')).toBeFalsy();
    });
});

describe('Wizard (native) — the footer nav labels carry NO decorative chevron', () => {
    // The footer buttons already render a `chevron-left`/`chevron-right` ICON, so a `<`/`>` inside the
    // LOCALIZED label duplicates it: the button paints a doubled chevron and a screen reader announces
    // "Next: Ingredients greater-than". These assertions are EXACT (not the loose `/Next: …/` used
    // elsewhere in this file) precisely because an unanchored regex still matches `Next: Ingredients >` —
    // which is how the stray glyphs shipped unnoticed.
    it('names the Next primary exactly, with no chevron glyph in the accessible name', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.getByLabelText('Next: Ingredients')).toBeTruthy();
        expect(screen.queryByLabelText(/[<>]/)).toBeFalsy();
    });

    it('names the Prev secondary exactly, with no chevron glyph in the accessible name', () => {
        render(<Harness initialValues={validValues()} initialStep={3} />);

        expect(screen.getByLabelText('Prev: Ingredients')).toBeTruthy();
        expect(screen.getByLabelText('Next: Review')).toBeTruthy();
        expect(screen.queryByLabelText(/[<>]/)).toBeFalsy();
    });
});

describe('Wizard (native) — the action bar carries Previous / Save Draft / Next (U32)', () => {
    it('shows Next — and NO Publish — on step 1', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.getByLabelText('Next: Ingredients')).toBeTruthy();
        expect(screen.queryByLabelText('Publish')).toBeFalsy();
    });

    it('swaps the primary to Publish — and NO Next — on the Review step', () => {
        render(<Harness initialValues={validValues()} initialStep={4} />);

        expect(screen.getByLabelText('Publish')).toBeTruthy();
        expect(screen.queryByLabelText(/^Next: /)).toBeFalsy();
    });

    it('hides Previous on step 1 and shows it once past the first step', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);
        expect(screen.queryByLabelText(/^Prev: /)).toBeFalsy();

        fireEvent.click(screen.getByLabelText('Next: Ingredients'));

        expect(screen.getByLabelText('Prev: Details')).toBeTruthy();
    });

    it('carries Save Draft as a FIRST-CLASS control on every step — no disclosure to open first', () => {
        // U32's substantive change for a phone user. Before this, Save Draft was reachable only by opening a
        // kebab, on a surface that also had no back affordance.
        for (const step of [1, 2, 3, 4] as const) {
            cleanup();
            render(<Harness initialValues={validValues()} initialStep={step} />);

            expect(screen.getByLabelText('Save Draft')).toBeTruthy();
        }
    });

    it('Save Draft in the bar calls the given action', () => {
        const onSaveDraft = vi.fn();
        render(<Harness initialValues={validValues()} onSaveDraft={onSaveDraft} />);

        fireEvent.click(screen.getByLabelText('Save Draft'));

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it('busies the bar’s Save Draft so it cannot be double-fired while a save is in flight', () => {
        // MOVED here from the deleted "overflow Save Draft item" describe — same guarantee, new control.
        const onSaveDraft = vi.fn();
        render(<Harness initialValues={validValues()} submitting onSaveDraft={onSaveDraft} />);

        fireEvent.click(screen.getByLabelText('Save Draft'));

        expect(onSaveDraft).not.toHaveBeenCalled();
    });

    it('announces the in-flight Save Draft as BUSY on web too, not merely unavailable (#123)', () => {
        // MOVED here from the deleted overflow-item describe. `aria-busy` is still the only channel: the
        // label does not change and no live region covers it.
        render(<Harness initialValues={validValues()} submitting />);

        expect(screen.getByLabelText('Save Draft').getAttribute('aria-busy')).toBe('true');
    });

    it('leaves an idle Save Draft unmarked, so busy stays distinguishable from disabled', () => {
        render(<Harness initialValues={validValues()} />);

        expect(screen.getByLabelText('Save Draft').getAttribute('aria-busy')).toBeNull();
    });
});

describe('Wizard (native) — the header is NEW, and its back arrow routes through the discard guard (U32)', () => {
    it('renders a localized back affordance and names the current step', () => {
        // `RecipesScreen` renders pushed surfaces bare, so before U32 this editor had no title and no exit
        // other than the hardware back button and a kebab item.
        render(<Harness initialValues={validValues()} initialStep={2} />);

        expect(screen.getByLabelText('Back')).toBeTruthy();
        expect(within(screen.getByLabelText('Recipe wizard actions')).getByText('Ingredients')).toBeTruthy();
    });

    it('renders NO overflow menu — both of its items moved out at this width', () => {
        render(<Harness initialValues={validValues()} />);

        expect(screen.queryByLabelText('More actions')).toBeFalsy();
    });

    it('offers no Preview affordance anywhere — Review replaced it (U33)', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.queryByLabelText('Preview')).toBeFalsy();
        expect(screen.queryByLabelText('Close preview')).toBeFalsy();
    });

    it('holds the back arrow behind the discard guard while there are unsaved edits', () => {
        const onCancel = vi.fn();
        render(<Harness initialValues={validValues()} isDirty onCancel={onCancel} />);

        fireEvent.click(screen.getByLabelText('Back'));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Discard changes'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('lets the back arrow leave straight away when there is nothing unsaved to lose', () => {
        const onCancel = vi.fn();
        render(<Harness initialValues={validValues()} isDirty={false} onCancel={onCancel} />);

        fireEvent.click(screen.getByLabelText('Back'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Discard unsaved changes?')).toBeFalsy();
    });

    it('gives the back control a 44pt touch target — it is the editor’s only deliberate exit', () => {
        render(<Harness initialValues={validValues()} />);
        const style = getComputedStyle(screen.getByLabelText('Back'));

        expect(Number.parseInt(style.minHeight, 10)).toBeGreaterThanOrEqual(44);
        expect(Number.parseInt(style.minWidth, 10)).toBeGreaterThanOrEqual(44);
    });
});





describe('Wizard (native) — Publish & submitting', () => {
    it('Publish calls the given action and carries the "Publish" accessible name in create mode (w3/e7)', () => {
        const onPublish = vi.fn();
        render(<Harness mode="create" initialValues={validValues()} initialStep={4} onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });

    it('Publish carries the SAME "Publish" accessible name in edit mode (w3/e7: label matches behavior, not mode)', () => {
        render(<Harness mode="edit" initialValues={validValues()} initialStep={4} />);

        expect(screen.getByLabelText('Publish')).toBeTruthy();
    });

    it('Publish while another step is invalid flags that OTHER step in the rail (no navigation occurs)', () => {
        const onPublish = vi.fn();
        const partial: RecipeFormValues = { ...defaultRecipeFormValues(), title: 'Herb Risotto', servings: 4 };
        render(<Harness initialValues={partial} initialStep={4} onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText(/Ingredients: needs attention/)).toBeTruthy();
        expect(screen.getByLabelText(/Instructions: needs attention/)).toBeTruthy();
        expect(screen.getByText('Review step body')).toBeTruthy();
    });

    it('busies the footer Publish primary so it cannot be double-fired while a save is in flight', () => {
        const onPublish = vi.fn();
        render(<Harness initialValues={validValues()} initialStep={4} submitting onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).not.toHaveBeenCalled();
    });

});

describe('Wizard (native) — discard guard', () => {
    // The three "Cancel via the overflow menu" cases that lived here are GONE with the menu. Their guarantee
    // — an exit while dirty must confirm first, and "Keep editing" must not discard — did not go with them:
    // it is asserted against the control that replaced Cancel, in the header describe above (the back arrow's
    // guarded and unguarded paths). What is left here is the OTHER guarded exit, which no other test covers.

    it('backward rail navigation with unsaved edits is guarded too', () => {
        render(<Harness initialValues={validValues()} initialStep={3} isDirty />);

        fireEvent.click(screen.getByLabelText(/Details:/));

        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Discard changes'));
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });

    it('choosing "Keep editing" from a guarded rail jump dismisses without discarding', () => {
        render(<Harness initialValues={validValues()} initialStep={3} isDirty />);

        fireEvent.click(screen.getByLabelText(/Details:/));
        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeFalsy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();
    });

    it('leaves FORWARD navigation unguarded — nothing is discarded by advancing', () => {
        render(<Harness initialValues={validValues()} initialStep={1} isDirty />);

        fireEvent.click(screen.getByLabelText('Next: Ingredients'));

        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeFalsy();
        expect(screen.getByText('Ingredients step body')).toBeTruthy();
    });
});

describe('Wizard (native) — chrome landmark labels (a11y, localized, not shared)', () => {
    it('gives the rail region and the header their OWN distinct localized accessible labels', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Recipe wizard steps')).toBeTruthy();
        expect(screen.getByLabelText('Recipe wizard actions')).toBeTruthy();
    });

    // REPLACES "names the overflow trigger with a localized label": that trigger no longer exists on native
    // (U32 — both its items moved out), so the assertion moved to the control that took its place. The
    // trigger's own localized-name coverage still runs, in the web spec, where the kebab still ships.
    it('names the back affordance with a localized label (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Back')).toBeTruthy();
    });

    it('gives the action-bar region a localized accessible label (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Wizard step navigation')).toBeTruthy();
    });
});

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules (`getComputedStyle` does not resolve them) and falling back to
 * the inline `style` attribute for per-render styles. Same helper as `CollectionHeader.native.test.tsx` /
 * `RecipeFilterBar.native.test.tsx`, which established the idiom.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return (resolved ?? (element as HTMLElement).style.getPropertyValue(property)) || undefined;
}

/**
 * Regression (Maestro CI view-hierarchy dump): the rail used to be a horizontal `ScrollView`, so its four
 * pills were laid out on ONE unbounded line — `[1 Details] [2 Ingredients] [3 Instructions] [4 Review]` needs
 * ~390dp but a 360dp phone leaves ~296dp inside the screen's and the rail's own 16dp paddings. Steps 3–4
 * therefore sat past the right screen edge: on-device step 4 rendered clipped ("4 Pl…") at the 1080px
 * boundary, reachable only by a horizontal drag that (a) is undiscoverable and (b) fights the vertical
 * `ScrollView` the rail is nested in. It is why `.maestro/recipes/photos.yaml` walks the FOOTER `Next: …`
 * primaries instead of jumping via the rail.
 *
 * The fix is the web leaf's own treatment (`ol className="flex flex-wrap …"`): the pill row WRAPS, so a pill
 * that does not fit moves to the next line instead of off the screen, and no scroller hides it. jsdom has no
 * layout engine, so this pins the flex CONTRACT that makes the clipping unrepresentable.
 */
describe('Wizard (native) — the step rail cannot push a step off the screen edge', () => {
    /** The row that lays out the four step pills — the pills' own parent. */
    const pillRow = (): HTMLElement => screen.getByLabelText(/Review:/).parentElement as HTMLElement;

    it('wraps the pill row instead of laying the four pills out on one over-wide line', () => {
        render(<Harness />);

        expect(appliedStyle(pillRow(), 'flex-wrap')).toBe('wrap');
    });

    it('puts the pills in no horizontally scrolling ancestor, so no step is hidden behind a swipe', () => {
        render(<Harness />);

        const rail = screen.getByLabelText('Recipe wizard steps');

        for (let node: HTMLElement | null = pillRow(); node !== null; node = node.parentElement) {
            expect(appliedStyle(node, 'overflow-x')).not.toBe('auto');
            expect(appliedStyle(node, 'overflow-x')).not.toBe('scroll');

            if (node === rail) {
                break;
            }
        }
    });

    it('lets a pill shrink (wrapping its label) rather than overflow the row, but never its step marker', () => {
        render(<Harness />);

        const pill = screen.getByLabelText(/Instructions:/);
        // The number badge is the pill's fixed chrome — squeezing it would deform the circle.
        const marker = pill.firstElementChild as Element;

        expect(appliedStyle(pill, 'flex-shrink')).toBe('1');
        expect(appliedStyle(marker, 'flex-shrink')).toBe('0');
    });

    it('keeps every step reachable by its accessible name (all four pills present, none clipped away)', () => {
        render(<Harness />);

        expect(screen.getByLabelText(/Details:/)).toBeTruthy();
        expect(screen.getByLabelText(/Ingredients:/)).toBeTruthy();
        expect(screen.getByLabelText(/Instructions:/)).toBeTruthy();
        expect(screen.getByLabelText(/Review:/)).toBeTruthy();
    });
});

/**
 * Cross-platform parity for the web rail-marker contrast fix. The marker's NUMERAL is text a reader reads to
 * know which step they are on, so SC 1.4.3's 4.5:1 applies (12px — no large-text exemption). Only the numeral's
 * colour is measured: the marker's `borderColor` is a non-text boundary bound by SC 1.4.11's 3:1, which seafoam
 * clears, and it is deliberately left alone (see the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`).
 *
 * The `current` marker's own fill is opaque `palette.white`, which is the surface behind the numeral.
 */
describe('Wizard (native) — WCAG AA rail-marker contrast (SC 1.4.3)', () => {
    it('the current step’s marker numeral is legible on the marker’s own fill', () => {
        render(<Harness initialStep={2} />);

        // Scope to the current step's pill: bare numerals collide across the four markers (and with form values).
        const numeral = within(screen.getByLabelText(/Ingredients: current step/)).getByText('2');

        expect(
            computedContrast(numeral, { surface: palette.white }),
            'current step’s rail-marker numeral, on the marker’s white fill',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

