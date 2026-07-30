/**
 * Component tests for the native `Wizard` compound shell (w3/e1,e2; U6 chrome remediation) — mirrors
 * `Wizard.test.tsx`'s harness and coverage against the RN leaf, run through react-native-web under jsdom per
 * this package's native test convention.
 *
 * **U6 chrome model (mirrored from the web spec):** the footer (`Wizard.Controls`) is the ONE contextual
 * primary — `Next: {name}` on steps 1–3, `Publish` on step 4 (never both), with a secondary `Prev` once past
 * step 1. The header (`Wizard.TopBar`) keeps `Preview` and demotes `Save Draft` + `Cancel` into an overflow
 * ("More actions") menu, so it never packs four buttons and Publish is gone from it.
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
            <Wizard.Rail />
            <Wizard.TopBar />
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
                <Text>Photos step body</Text>
            </Wizard.Step>
            <Wizard.Controls />
        </Wizard>
    );
};

/**
 * The header's overflow ("More actions") disclosure TRIGGER, scoped to the toolbar. The open menu's backdrop
 * carries the same accessible name, so an unscoped `getByLabelText('More actions')` is ambiguous once the menu
 * is open — this stays unambiguous in both states.
 */
const actionsTrigger = (): HTMLElement =>
    within(screen.getByLabelText('Recipe wizard actions')).getByRole('button', { name: 'More actions' });

/** Open the header's overflow ("More actions") menu, disclosing the Save Draft / Cancel items. */
const openActionsMenu = (): void => {
    fireEvent.click(screen.getByLabelText('More actions'));
};

describe('Wizard (native) — Wizard.Step gating', () => {
    it('renders only the active step body', () => {
        render(<Harness initialStep={1} />);

        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect(screen.queryByText('Ingredients step body')).toBeFalsy();
        expect(screen.queryByText('Photos step body')).toBeFalsy();
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
        expect(screen.getByLabelText(/Basic: needs attention/)).toBeTruthy();
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

        expect(screen.getByLabelText(/Basic: completed/)).toBeTruthy();
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
        fireEvent.click(screen.getByLabelText(/Photos: not yet started/));
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
        expect(screen.getByLabelText('Next: Photos')).toBeTruthy();
        expect(screen.queryByLabelText(/[<>]/)).toBeFalsy();
    });
});

describe('Wizard (native) — footer is the ONE contextual primary (U6)', () => {
    it('shows Next — and NO Publish, NO Prev — on step 1', () => {
        render(<Harness initialValues={validValues()} initialStep={1} />);

        expect(screen.getByLabelText(/Next: Ingredients/)).toBeTruthy();
        expect(screen.queryByLabelText('Publish')).toBeFalsy();
        expect(screen.queryByLabelText(/Prev:/)).toBeFalsy();
    });

    it('shows Next — and NO Publish — on step 3, plus a Prev', () => {
        render(<Harness initialValues={validValues()} initialStep={3} />);

        expect(screen.getByLabelText(/Next: Photos/)).toBeTruthy();
        expect(screen.getByLabelText(/Prev: Ingredients/)).toBeTruthy();
        expect(screen.queryByLabelText('Publish')).toBeFalsy();
    });

    it('swaps the footer primary to Publish — and NO Next — on step 4', () => {
        render(<Harness initialValues={validValues()} initialStep={4} />);

        expect(screen.getByLabelText('Publish')).toBeTruthy();
        expect(screen.queryByLabelText(/Next:/)).toBeFalsy();
    });

    it('Publish in the footer calls publish', () => {
        const onPublish = vi.fn();
        render(<Harness initialValues={validValues()} initialStep={4} onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).toHaveBeenCalledTimes(1);
    });
});

describe('Wizard (native) — header overflow menu (U6: Save Draft + Cancel demoted)', () => {
    it('does not pack four buttons in the header — only Preview + the overflow trigger', () => {
        render(<Harness />);

        const toolbar = screen.getByLabelText('Recipe wizard actions');
        expect(within(toolbar).getAllByRole('button')).toHaveLength(2);
        expect(within(toolbar).queryByLabelText('Publish')).toBeFalsy();
        // Save Draft + Cancel stay hidden until the overflow menu opens.
        expect(screen.queryByLabelText('Save Draft')).toBeFalsy();
        expect(screen.queryByLabelText('Cancel')).toBeFalsy();
    });

    it('discloses Save Draft + Cancel from the overflow menu, and Save Draft calls the given action', () => {
        const onSaveDraft = vi.fn();
        render(<Harness onSaveDraft={onSaveDraft} />);

        openActionsMenu();

        expect(screen.getByLabelText('Save Draft')).toBeTruthy();
        expect(screen.getByLabelText('Cancel')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Save Draft'));

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        // Choosing an item closes the menu.
        expect(screen.queryByLabelText('Save Draft')).toBeFalsy();
    });
});

/**
 * The overflow trigger is a DISCLOSURE, and its expanded state has to reach assistive tech on the mobile-WEB
 * build too — `accessibilityState={{ expanded }}` alone does not get there (#123).
 *
 * Verified against the installed react-native-web (0.20.0): its `forwardedProps` allowlist carries every
 * literal `aria-*` attribute but has NO entry that projects `accessibilityState` — the only consumer anywhere
 * in the package is `AccessibilityUtil/isDisabled`, and even that reads the LEGACY `accessibilityStates` array.
 * So this trigger rendered `<button role="button">` with no state attribute at all: a kebab that announces
 * neither that pressing it will reveal something, nor that the menu is now open. The chevron swap in
 * `CuisineSelect.native` and the ⋮ glyph here are SIGHTED affordances only. Both sibling disclosure triggers in
 * this feature (`MoreActionsMenu.native`, `CuisineSelect.native`) already carried `aria-expanded`; this one was
 * the outlier.
 *
 * `accessibilityState` stays alongside it: RN reverse-maps `aria-expanded` into `accessibilityState.expanded`
 * (`Pressable.js`: `expanded: ariaExpanded ?? accessibilityState?.expanded`), so the dual form is correct on
 * both platforms and dropping either one silences one of them.
 *
 * BOTH polarities are asserted, and for a disclosure the FALSE one is the load-bearing case:
 * `aria-expanded="false"` is what tells a screen-reader user the control reveals something. An absent
 * attribute says nothing at all — which is exactly the defect.
 */
describe('Wizard (native) — the overflow trigger announces its expanded state on web too', () => {
    it('reports collapsed (present-and-false, not absent) while the menu is closed', () => {
        render(<Harness />);

        expect(actionsTrigger().getAttribute('aria-expanded')).toBe('false');
    });

    it('reports expanded once the menu is open', () => {
        render(<Harness />);

        openActionsMenu();

        expect(actionsTrigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('reports collapsed again once an item closes the menu', () => {
        // Mutation guard: a hard-coded `aria-expanded="true"` would pass the case above. The attribute has to
        // track the disclosure back down again.
        render(<Harness />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));

        expect(actionsTrigger().getAttribute('aria-expanded')).toBe('false');
    });
});

/**
 * The overflow menu's Save Draft item busies while a save is in flight, and that state has to reach the DOM too
 * (#123). Its `disabled` half already does — RNW derives `aria-disabled` from the `disabled` PROP — but the
 * `busy` half went nowhere, so the control was announced as merely unavailable rather than working. The label
 * does not change and no live region covers it, so `aria-busy` was the only channel and it was silent.
 *
 * `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`), so it is
 * device-correct as well; the `|| undefined` shape (matching `PressScale.native`, `RecipeVersionList.native`
 * and `AccountEraseDialog.native`) omits it when idle, since ARIA already defaults `aria-busy` to false.
 */
describe('Wizard (native) — the overflow Save Draft item announces its busy state on web too', () => {
    it('marks the in-flight Save Draft item busy', () => {
        render(<Harness submitting />);

        openActionsMenu();

        expect(screen.getByLabelText('Save Draft').getAttribute('aria-busy')).toBe('true');
    });

    it('leaves an idle Save Draft item unmarked, and distinguishable from disabled', () => {
        render(<Harness />);

        openActionsMenu();

        const item = screen.getByLabelText('Save Draft');
        expect(item.getAttribute('aria-busy')).toBeNull();
        expect(item.hasAttribute('disabled')).toBe(false);
    });
});

describe('Wizard (native) — top-bar actions & submitting', () => {
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
        expect(screen.getByText('Photos step body')).toBeTruthy();
    });

    it('busies the footer Publish primary so it cannot be double-fired while a save is in flight', () => {
        const onPublish = vi.fn();
        render(<Harness initialValues={validValues()} initialStep={4} submitting onPublish={onPublish} />);

        fireEvent.click(screen.getByLabelText('Publish'));

        expect(onPublish).not.toHaveBeenCalled();
    });

    it('busies the overflow Save Draft item so it cannot be double-fired while a save is in flight', () => {
        const onSaveDraft = vi.fn();
        render(<Harness submitting onSaveDraft={onSaveDraft} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Save Draft'));

        expect(onSaveDraft).not.toHaveBeenCalled();
    });
});

describe('Wizard (native) — discard guard (Cancel now lives in the overflow menu)', () => {
    it('Cancel with no unsaved edits calls onCancel immediately (no dialog)', () => {
        const onCancel = vi.fn();
        render(<Harness isDirty={false} onCancel={onCancel} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeFalsy();
    });

    it('Cancel with unsaved edits shows the discard dialog; confirming discards (calls onCancel)', () => {
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Discard changes'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Cancel with unsaved edits: choosing "Keep editing" dismisses the dialog without discarding', () => {
        const onCancel = vi.fn();
        render(<Harness isDirty onCancel={onCancel} />);

        openActionsMenu();
        fireEvent.click(screen.getByLabelText('Cancel'));
        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(onCancel).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeFalsy();
    });

    it('backward rail navigation with unsaved edits is guarded too', () => {
        render(<Harness initialValues={validValues()} initialStep={3} isDirty />);

        fireEvent.click(screen.getByLabelText(/Basic:/));

        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();
        expect(screen.getByText('Instructions step body')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Discard changes'));
        expect(screen.getByLabelText('Title')).toBeTruthy();
    });
});

describe('Wizard (native) — chrome landmark labels (a11y, localized, not shared)', () => {
    it('gives the rail region and the top-bar their OWN distinct localized accessible labels', () => {
        render(<Harness />);

        expect(screen.getByLabelText('Recipe wizard steps')).toBeTruthy();
        expect(screen.getByLabelText('Recipe wizard actions')).toBeTruthy();
    });

    it('names the overflow trigger with a localized label (not a raw literal)', () => {
        render(<Harness />);

        expect(screen.getByLabelText('More actions')).toBeTruthy();
    });

    it('gives the footer step-navigation region a localized accessible label (not a raw literal)', () => {
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
 * pills were laid out on ONE unbounded line — `[1 Basic] [2 Ingredients] [3 Instructions] [4 Photos]` needs
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
    const pillRow = (): HTMLElement => screen.getByLabelText(/Photos:/).parentElement as HTMLElement;

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

        expect(screen.getByLabelText(/Basic:/)).toBeTruthy();
        expect(screen.getByLabelText(/Ingredients:/)).toBeTruthy();
        expect(screen.getByLabelText(/Instructions:/)).toBeTruthy();
        expect(screen.getByLabelText(/Photos:/)).toBeTruthy();
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

describe('Wizard (native) — Preview', () => {
    it('shows the current draft values and can be closed', () => {
        render(<Harness initialValues={validValues()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        // The panel's own accessible label collides with the top-bar button's ("Preview"), and bare numeric
        // values collide with the rail's step-number badges — so scope the servings assertion to its own
        // label/value row rather than querying the page for a bare "4".
        expect(screen.getByLabelText('Close preview')).toBeTruthy();
        expect(screen.getByText('Herb Risotto')).toBeTruthy();
        const servingsRow = screen.getByText('Servings').parentElement;
        expect(within(servingsRow as HTMLElement).getByText('4')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('Close preview'));
        expect(screen.queryByLabelText('Close preview')).toBeFalsy();
    });
});
