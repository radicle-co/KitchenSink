/**
 * @module @commise/features-recipes/wizard — native 4-step recipe-edit wizard SHELL (w3/e1,e2, P8). The
 * React Native leaf of `Wizard` — same compound-component shape (Root + Context
 * + `useWizardModel()` + `Object.assign` parts), same navigation statechart (attempted steps, discard guard,
 * blocked-advance notice); see that module's doc for the full rationale, including why `Wizard.Header` and
 * `Wizard.Controls` are deliberately two separate parts rather than the plan's literal single "Controls".
 *
 * **Native adaptation (per the plan):** `Wizard.Rail` collapses to a WRAPPING pill row plus "Step N of 4"
 * (it was a horizontally scrollable row until that row was found laying steps 3–4 past the screen edge — see
 * {@link WizardRail}); `Wizard.Step` bodies are full-screen (the composing screen wraps its `Wizard.Step`
 * content in its own `ScrollView`, exactly as `RecipeForm.native.tsx` already does for the flat form).
 *
 * **U32 — `Wizard.Header` is NEW, and it is not a restyle** (owner ruling 2026-08-25). `RecipesScreen`
 * renders every pushed surface bare — no title, no back affordance — so the editor had no way out except the
 * hardware back button and a kebab item. This part is the header that never existed: a BACK control routed
 * through the SAME `requestCancel` the overflow menu's `Cancel` used, so the discard guard still fires, plus
 * the step's name as a heading. Native is always below the web leaf's `lg` cutover, so — exactly as on web
 * below `lg` — there is no kebab here at all: `Save Draft` lives in the action bar and `Cancel` is this
 * arrow, leaving the menu with nothing to disclose.
 *
 * ⛔ **`Wizard.Controls` is PINNED, and that is a SHIPPED-DEFECT FIX rather than a restyle.** It used to be
 * rendered INSIDE `RecipeEditor.tsx`'s single `ScrollView`, together with the rail and all four step bodies —
 * so on a recipe with a long ingredient list the primary control scrolled away beneath it and a cook had to
 * scroll the whole list to reach `Next`. (`useScrollResetOnChange` exists because four Maestro flows caught
 * the consequence: advancing left the cook at the BOTTOM of the next step.) The composing screen now places
 * this part as a SIBLING BELOW that scroller, so it cannot scroll at all. The bottom safe-area inset is
 * applied ONCE, by `RecipesScreen`'s container — see this part's own note on why it is not re-applied here.
 *
 * **U33 — Preview is GONE, replaced by the Review step** (owner ruling 2026-08-25). The `Preview` button and
 * the overlay it opened are DELETED, not merely unrendered; step 4 is Review. See the web leaf's doc.
 */
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import { createContext, useContext, useState, type FC, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from '../form/messages.js';
import type { RecipeFormErrors, RecipeFormValues, RecipeWizardStep } from '../form/model.js';
import {
    blockedAdvanceErrors,
    deriveRailStepState,
    nextStep,
    previousStep,
    WIZARD_STEPS,
    WIZARD_TOTAL_STEPS,
} from './model.js';
import { wizardMessages } from './messages.js';

/** Props for {@link Wizard} (Root) — identical contract to the web leaf. */
export interface WizardProps {
    /**
     * Create vs edit. Informational only (w3/e7): the Publish action's accessible name is `Publish` in BOTH
     * modes — see the web leaf's doc for the full rationale.
     */
    readonly mode: 'create' | 'edit';
    readonly step: RecipeWizardStep;
    readonly values: RecipeFormValues;
    readonly canAdvanceFrom: (step: RecipeWizardStep) => boolean;
    readonly stepErrors: (step: RecipeWizardStep) => RecipeFormErrors;
    readonly goNext: () => void;
    readonly goPrev: () => void;
    readonly goToStep: (step: RecipeWizardStep) => void;
    readonly saveDraft: () => void;
    readonly publish: () => void;
    readonly onCancel: () => void;
    readonly isDirty: boolean;
    readonly submitting: boolean;
    readonly children: ReactNode;
}

interface WizardModel extends Omit<WizardProps, 'children'> {
    readonly attempted: ReadonlySet<RecipeWizardStep>;
    /**
     * The step whose `Next` was just REFUSED, or `null` — gates the footer's blocked-advance notice. See the
     * web leaf's identical field for why this is NOT `attempted` (Publish would double-report).
     */
    readonly blockedStep: RecipeWizardStep | null;
    readonly requestGoNext: () => void;
    readonly requestGoPrev: () => void;
    readonly requestGoToStep: (step: RecipeWizardStep) => void;
    readonly requestCancel: () => void;
    readonly requestPublish: () => void;
}

const WizardContext = createContext<WizardModel | null>(null);

function useWizardModel(): WizardModel {
    const model = useContext(WizardContext);

    if (model === null) {
        throw new Error('Wizard.* parts must be rendered inside a <Wizard>.');
    }

    return model;
}

const WizardRoot: FC<WizardProps> = (props) => {
    const { step, canAdvanceFrom, isDirty, onCancel, goNext, goPrev, goToStep, publish, children } = props;
    const m = useMessages(wizardMessages);
    const [attempted, setAttempted] = useState<ReadonlySet<RecipeWizardStep>>(new Set());
    const [blockedStep, setBlockedStep] = useState<RecipeWizardStep | null>(null);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const markAttempted = (target: RecipeWizardStep): void =>
        setAttempted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));

    const requestGoNext = (): void => {
        markAttempted(step);
        // Record a REFUSED advance so the footer can say why; cleared on a successful advance.
        setBlockedStep(canAdvanceFrom(step) ? null : step);
        goNext();
    };

    const guardIfBackward = (target: RecipeWizardStep, action: () => void): void => {
        if (isDirty && target < step) {
            setPendingAction(() => action);
        } else {
            action();
        }
    };

    const requestGoPrev = (): void => {
        if (step > 1) {
            guardIfBackward((step - 1) as RecipeWizardStep, goPrev);
        }
    };

    const requestGoToStep = (target: RecipeWizardStep): void => guardIfBackward(target, () => goToStep(target));

    const requestCancel = (): void => {
        if (isDirty) {
            setPendingAction(() => onCancel);
        } else {
            onCancel();
        }
    };

    const requestPublish = (): void => {
        setAttempted(new Set(WIZARD_STEPS));
        // A refused Publish is answered by the container's own whole-form `errors`, rendered inline by the
        // step bodies — the footer must not repeat those sentences.
        setBlockedStep(null);
        publish();
    };

    const model: WizardModel = {
        ...props,
        attempted,
        blockedStep,
        requestGoNext,
        requestGoPrev,
        requestGoToStep,
        requestCancel,
        requestPublish,
    };

    return (
        <WizardContext.Provider value={model}>
            {children}

            <ConfirmDialog
                open={pendingAction !== null}
                title={m.discardTitle}
                description={m.discardBody}
                confirmLabel={m.discardConfirm}
                cancelLabel={m.discardCancel}
                destructive
                onConfirm={() => {
                    pendingAction?.();
                    setPendingAction(null);
                }}
                onCancel={() => setPendingAction(null)}
            />
        </WizardContext.Provider>
    );
};

/** Renders its children only while `step` is the wizard's active step (a full-screen body). */
const WizardStep: FC<{ readonly step: RecipeWizardStep; readonly children: ReactNode }> = ({ step, children }) => {
    const model = useWizardModel();

    return model.step === step ? <>{children}</> : null;
};

type RailState = 'completed' | 'current' | 'invalid' | 'upcoming';

type StateWordKey = 'stateCompleted' | 'stateCurrent' | 'stateInvalid' | 'stateUpcoming';

const RAIL_STATE_LABEL: Record<RailState, StateWordKey> = {
    completed: 'stateCompleted',
    current: 'stateCurrent',
    invalid: 'stateInvalid',
    upcoming: 'stateUpcoming',
};

const RAIL_MARKER_STYLE: Record<RailState, { backgroundColor: string; borderColor: string }> = {
    completed: { backgroundColor: palette.seafoam, borderColor: palette.seafoam },
    current: { backgroundColor: palette.white, borderColor: palette.seafoam },
    invalid: { backgroundColor: palette.error, borderColor: palette.error },
    upcoming: { backgroundColor: palette.white, borderColor: 'rgba(178, 190, 195, 0.5)' },
};

// This table colours the marker's NUMERAL — read text, so SC 1.4.3's 4.5:1 applies. The marker's BORDER
// (`RAIL_MARKER_STYLE` above) is a non-text boundary at SC 1.4.11's 3:1 and keeps seafoam. See the palette
// JSDoc in `@commise/ui`'s `tokens/colors.ts` for the one authoritative statement of that split.
const RAIL_MARKER_TEXT_COLOR: Record<RailState, string> = {
    completed: palette.white,
    current: palette['ocean-dark'],
    invalid: palette.white,
    upcoming: palette.slate,
};

/**
 * The step-rail: a WRAPPING pill row + "Step N of 4" (native adaptation of FR-044).
 *
 * It wraps rather than scrolls horizontally, which is a bug fix, not a restyle. The four pills
 * (`[1 Details] [2 Ingredients] [3 Instructions] [4 Review]`) need ~390dp, while a 360dp phone leaves ~296dp
 * inside the composing screen's and this rail's own 16dp paddings — so on one unbounded line steps 3–4 were
 * laid out past the right screen edge (the Maestro view-hierarchy dump caught step 4 clipped at the 1080px
 * boundary), reachable only by a horizontal drag that is undiscoverable AND fights the vertical `ScrollView`
 * this rail is nested in. It is why `.maestro/recipes/photos.yaml` walks the footer `Next: …` primaries
 * instead of jumping via the rail. Wrapping is also exactly what the web leaf's `ol` already does
 * (`flex flex-wrap`), so the two platforms converge rather than diverge.
 */
const WizardRail: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <View accessibilityLabel={m.railLabel} style={styles.railContainer}>
            <Text style={styles.railProgress}>
                {fillTemplate(m.stepProgress, { current: model.step, total: WIZARD_TOTAL_STEPS })}
            </Text>
            <View style={styles.railRow}>
                {WIZARD_STEPS.map((s) => {
                    const name = m.stepNames[s];
                    const railState = deriveRailStepState({
                        step: s,
                        currentStep: model.step,
                        attempted: model.attempted.has(s),
                        hasErrors: Object.keys(model.stepErrors(s)).length > 0,
                    });
                    const stateWord = m[RAIL_STATE_LABEL[railState]];

                    return (
                        <Pressable
                            key={s}
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(m.railStepLabel, { name, state: stateWord })}
                            onPress={() => model.requestGoToStep(s)}
                            style={styles.railPill}
                        >
                            <View style={[styles.railMarker, RAIL_MARKER_STYLE[railState]]}>
                                <Text
                                    style={{
                                        color: RAIL_MARKER_TEXT_COLOR[railState],
                                        fontSize: 12,
                                        fontWeight: '600',
                                    }}
                                >
                                    {s}
                                </Text>
                            </View>
                            <Text style={styles.railPillLabel}>{name}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
};

/**
 * The sticky wizard header (U32) — NEW on native, not a restyle of anything.
 *
 * `RecipesScreen` renders every pushed surface bare, so before this the editor had no title and no back
 * affordance at all. The back control routes through `requestCancel`, which means the discard guard fires
 * exactly as it did for the overflow menu's deleted `Cancel` item — it is NOT a navigation control and must
 * never be wired to one. The heading names the RECIPE — not the step, which the rail's "Step N of 4" and the
 * step body's own section heading already say twice. Two headings called "Review" on one screen was the
 * concrete outcome of naming the step here.
 *
 * No overflow menu here. Native is always below the web leaf's `lg` cutover, and at that width both of the
 * menu's items have moved out: `Save Draft` is a first-class control in {@link WizardControls}, and `Cancel`
 * is this arrow. A kebab would disclose an empty list.
 */
const WizardHeader: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <View accessibilityLabel={m.headerLabel} style={styles.header}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.back}
                onPress={model.requestCancel}
                style={styles.backControl}
            >
                <Feather name="arrow-left" size={22} color={palette.charcoal} />
            </Pressable>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
                {model.values.title.trim() === '' ? m.untitledRecipe : model.values.title.trim()}
            </Text>
            {/* Balances the back control's width so the heading stays optically centred. */}
            <View style={styles.headerSpacer} />
        </View>
    );
};

/**
 * The PINNED action bar (U32) — `Previous / Save Draft / Next`, with `Publish` in Next's slot on the last
 * step.
 *
 * The composing screen places this OUTSIDE its `ScrollView`, and that placement IS the unit: inside it, the
 * primary control scrolled away beneath a long ingredient list. Nothing in this component can enforce that
 * from here, so `RecipeEditor.tsx` carries the matching note and its screen test asserts the bar is not a
 * descendant of the scroller.
 *
 * The bottom safe-area inset is applied ONCE, by `RecipesScreen`'s container (`paddingBottom: insets.bottom`),
 * which wraps every pushed surface including this editor. Re-applying it here would double-pad the bar on
 * every gesture-navigation device — so this component pads for TOUCH TARGET only, and the screen pads for
 * the gesture bar. The web leaf's `env(safe-area-inset-bottom)` is the same rule spelled in CSS, where there
 * is no enclosing padded container to inherit it from.
 *
 * Three controls, never four: `Save Draft` is a real control here rather than an overflow item a phone user
 * had to go looking for.
 */
const WizardControls: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const f = useMessages(recipeFormMessages);
    const prev = previousStep(model.step);
    const next = nextStep(model.step);
    // Why the refusal is voiced HERE, next to the control that refused: see `blockedAdvanceErrors`.
    const blocking = blockedAdvanceErrors(model.blockedStep === model.step, model.stepErrors(model.step));

    return (
        <View style={styles.controls}>
            {blocking.length > 0 && (
                <View accessibilityRole="alert" style={styles.blockedNotice}>
                    {blocking.map((code) => (
                        <Text key={code} style={styles.blockedText}>
                            {f.errors[code]}
                        </Text>
                    ))}
                </View>
            )}
            <View accessibilityLabel={m.controlsLabel} style={styles.controlsRow}>
                {prev !== null ? (
                    <Button
                        variant="secondary"
                        icon={<Feather name="chevron-left" size={16} color={palette.charcoal} />}
                        onPress={model.requestGoPrev}
                    >
                        {fillTemplate(m.prevLabel, { name: m.stepNames[prev] })}
                    </Button>
                ) : (
                    <View />
                )}
                <Button
                    variant="secondary"
                    icon={<Feather name="save" size={16} color={palette.charcoal} />}
                    busy={model.submitting}
                    onPress={model.saveDraft}
                >
                    {m.saveDraft}
                </Button>
                {next !== null ? (
                    <Button
                        icon={<Feather name="chevron-right" size={16} color={palette.white} />}
                        onPress={model.requestGoNext}
                    >
                        {fillTemplate(m.nextLabel, { name: m.stepNames[next] })}
                    </Button>
                ) : (
                    <Button
                        icon={<Feather name="check" size={16} color={palette.white} />}
                        busy={model.submitting}
                        onPress={model.requestPublish}
                    >
                        {m.publish}
                    </Button>
                )}
            </View>
        </View>
    );
};

/** The 4-step recipe-edit wizard shell: `<Wizard>` plus its `.Step`/`.Rail`/`.Header`/`.Controls` parts. */
export const Wizard = Object.assign(WizardRoot, {
    Step: WizardStep,
    Rail: WizardRail,
    Header: WizardHeader,
    Controls: WizardControls,
});

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    railContainer: { gap: 8, paddingHorizontal: 16, paddingTop: 12 },
    railProgress: { fontSize: 13, color: palette.slate },
    // `flexWrap` is load-bearing (see `WizardRail`): a pill that does not fit moves to the NEXT LINE instead
    // of past the screen edge. The shrink pair below is its backstop — line-breaking uses each pill's flex
    // BASIS, so a single pill wider than the row (a long localized step name at a large font scale) is the
    // one case wrapping cannot solve: `flexShrink: 1` lets that pill yield width and wrap its label, while
    // `flexShrink: 0` keeps the number badge a circle. RN defaults `flexShrink` to 0, so both are explicit.
    railRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, paddingBottom: 8 },
    railPill: { flexDirection: 'row', flexShrink: 1, alignItems: 'center', gap: 6 },
    railMarker: {
        flexShrink: 0,
        width: 24,
        height: 24,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    railPillLabel: { fontSize: 13, color: palette.charcoal },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 8,
        backgroundColor: palette.white,
        borderBottomWidth: 1,
        borderBottomColor: border,
    },
    // 44pt minimums: this is the editor's only deliberate exit, so it must not be a thumb-sized miss.
    backControl: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flexShrink: 1, fontSize: 17, fontWeight: '600', color: palette.charcoal },
    headerSpacer: { width: 44 },
    // The bar's own surface. It is pinned by WHERE the composing screen puts it (outside the scroller), not
    // by absolute positioning: an absolutely-positioned bar would overlay the last rows of the step body,
    // which is the defect one layer up from the one being fixed.
    controls: {
        gap: 4,
        backgroundColor: palette.white,
        borderTopWidth: 1,
        borderTopColor: border,
    },
    blockedNotice: { gap: 2, paddingHorizontal: 16, paddingTop: 12 },
    blockedText: { fontSize: 13, color: palette['error-dark'] },
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
});
