/**
 * @module @commise/features-recipes/wizard — native 4-step recipe-edit wizard SHELL (w3/e1,e2, P8). The
 * React Native leaf of {@link import('./Wizard.js').Wizard} — same compound-component shape (Root + Context
 * + `useWizardModel()` + `Object.assign` parts), same navigation statechart (attempted steps, discard guard,
 * preview toggle); see that module's doc for the full rationale, including why `Wizard.TopBar` and
 * `Wizard.Controls` are deliberately two separate parts rather than the plan's literal single "Controls".
 *
 * **Native adaptation (per the plan):** `Wizard.Rail` collapses to a WRAPPING pill row plus "Step N of 4"
 * (it was a horizontally scrollable row until that row was found laying steps 3–4 past the screen edge — see
 * {@link WizardRail}); `Wizard.Step` bodies are full-screen (the composing screen wraps its `Wizard.Step` content
 * in its own `ScrollView`, exactly as `RecipeForm.native.tsx` already does for the flat form); `Wizard.TopBar`
 * is a sticky header row the composing screen places above the scrolling step content.
 *
 * **U6 chrome remediation (plan bullet U6, SHARED with the web leaf — see its doc).** `Wizard.Controls`
 * (footer) is the ONE contextual primary: `Next: {name}` on steps 1–3, swapping to `Publish` on step 4 (so
 * Publish is NO LONGER live on steps 1–3), with a secondary `Prev` once past step 1. `Wizard.TopBar` (header)
 * keeps `Preview` and demotes `Save Draft` + `Cancel` into an overflow ("More actions") menu — a kebab
 * `Feather` trigger opening a `Modal` sheet of `Pressable` items (house style, cf. `ConfirmDialog.native`).
 * Cancel routes through `requestCancel` so the discard guard fires; Save Draft busies while submitting.
 */
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import { createContext, useContext, useState, type FC, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from '../form/messages.js';
import type { RecipeFormErrors, RecipeFormValues, RecipeWizardStep } from '../form/model.js';
import { blockedAdvanceErrors, deriveRailStepState, WIZARD_STEPS, WIZARD_TOTAL_STEPS } from './model.js';
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
    readonly previewOpen: boolean;
    readonly requestGoNext: () => void;
    readonly requestGoPrev: () => void;
    readonly requestGoToStep: (step: RecipeWizardStep) => void;
    readonly requestCancel: () => void;
    readonly requestPublish: () => void;
    readonly togglePreview: () => void;
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
    const [previewOpen, setPreviewOpen] = useState(false);
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

    const togglePreview = (): void => setPreviewOpen((open) => !open);

    const model: WizardModel = {
        ...props,
        attempted,
        blockedStep,
        previewOpen,
        requestGoNext,
        requestGoPrev,
        requestGoToStep,
        requestCancel,
        requestPublish,
        togglePreview,
    };

    return (
        <WizardContext.Provider value={model}>
            {children}

            {previewOpen && (
                <View accessibilityRole="none" style={styles.previewBackdrop}>
                    <View accessibilityLabel={m.previewHeading} style={styles.previewCard}>
                        <View style={styles.previewHeader}>
                            <Text accessibilityRole="header" style={styles.previewHeading}>
                                {m.previewHeading}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={m.previewClose}
                                onPress={togglePreview}
                            >
                                <Feather name="x" size={20} color={palette.slate} />
                            </Pressable>
                        </View>
                        {previewRow(m.previewTitle, props.values.title)}
                        {previewRow(m.previewDescription, props.values.description)}
                        {previewRow(m.previewServings, String(props.values.servings))}
                        {previewRow(m.previewIngredientCount, String(props.values.ingredients.length))}
                        {previewRow(m.previewStepCount, String(props.values.steps.length))}
                        {previewRow(
                            m.previewVisibility,
                            props.values.visibility === 'private'
                                ? m.previewVisibilityPrivate
                                : m.previewVisibilityPublic,
                        )}
                    </View>
                </View>
            )}

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

const previewRow = (label: string, value: string): ReactNode => (
    <View key={label} style={styles.previewRow}>
        <Text style={styles.previewLabel}>{label}</Text>
        <Text style={styles.previewValue}>{value}</Text>
    </View>
);

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
 * (`[1 Basic] [2 Ingredients] [3 Instructions] [4 Photos]`) need ~390dp, while a 360dp phone leaves ~296dp
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
                {WIZARD_STEPS.map((s, index) => {
                    const name = m.stepNames[index] ?? '';
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
 * The header's overflow ("More actions") disclosure (U6): a kebab (`more-vertical`) trigger opening a `Modal`
 * sheet of `Pressable` items — `Save Draft` and `Cancel` — in the house `ConfirmDialog.native` idiom.
 * Demoting these two off the header is what keeps it from packing four buttons that wrap on a phone. Cancel
 * routes through `requestCancel` so the discard guard still fires; Save Draft busies while submitting (a
 * disabled item cannot be double-fired). The `Modal` is rendered only while `open`, so its items are absent
 * from the tree when closed (react-native-web keeps a `visible={false}` Modal mounted — see
 * `ConfirmDialog.native`'s same guard).
 */
const WizardActionsMenu: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const [open, setOpen] = useState(false);

    // Every item closes the menu first, then runs its action — so Cancel's discard dialog opens over a closed
    // menu, not behind an open one.
    const runAndClose = (action: () => void): void => {
        setOpen(false);
        action();
    };

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.actionsMenu}
                // Both state forms are load-bearing, neither is redundant (#123). `accessibilityState.expanded`
                // is the DEVICE trait VoiceOver/TalkBack read; `aria-expanded` is the only one that reaches the
                // DOM — react-native-web forwards literal `aria-*` props and projects `accessibilityState` for
                // NOTHING, so the object form alone left this disclosure trigger with no state attribute at all
                // on the web build, and the ⋮ glyph is a SIGHTED affordance. Both sibling disclosure triggers
                // (`MoreActionsMenu.native`, `CuisineSelect.native`) already carry the alias. Keep both: RN
                // reverse-maps `aria-expanded` into `accessibilityState.expanded`. Unlike `aria-busy` this is
                // NOT omitted when false — for a disclosure, `aria-expanded="false"` is what announces that
                // the control reveals something at all.
                accessibilityState={{ expanded: open }}
                aria-expanded={open}
                onPress={() => setOpen(true)}
                style={styles.menuTrigger}
            >
                <Feather name="more-vertical" size={20} color={palette.charcoal} />
            </Pressable>
            {open && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                    <Pressable
                        accessibilityLabel={m.actionsMenu}
                        style={styles.menuBackdrop}
                        onPress={() => setOpen(false)}
                    >
                        <View style={styles.menuSheet}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={m.saveDraft}
                                // The `disabled` half already reaches the DOM (react-native-web derives
                                // `aria-disabled` from the `disabled` PROP below); `busy` did not, because RNW
                                // projects `accessibilityState` for nothing (#123) — so the in-flight item was
                                // announced as merely unavailable rather than working, with no label change or
                                // live region to say otherwise. `aria-busy` is RN's own first-class ALIAS for
                                // `accessibilityState.busy`, so it is device-correct too; omitted when idle,
                                // since ARIA already defaults it to false.
                                accessibilityState={{ disabled: model.submitting, busy: model.submitting }}
                                aria-busy={model.submitting || undefined}
                                disabled={model.submitting}
                                onPress={() => runAndClose(model.saveDraft)}
                                style={[styles.menuItem, model.submitting && styles.menuItemDisabled]}
                            >
                                <Feather name="save" size={16} color={palette.charcoal} />
                                <Text style={styles.menuItemLabel}>{m.saveDraft}</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={m.cancel}
                                onPress={() => runAndClose(model.requestCancel)}
                                style={styles.menuItem}
                            >
                                <Feather name="x" size={16} color={palette['error-dark']} />
                                <Text style={styles.menuItemDestructiveLabel}>{m.cancel}</Text>
                            </Pressable>
                        </View>
                    </Pressable>
                </Modal>
            )}
        </>
    );
};

/**
 * The sticky header (U6): `Preview` as its own button plus the overflow ("More actions") menu carrying Save
 * Draft + Cancel. Two controls, never four — the four-button wrap is gone. Publish is no longer here; it is
 * the footer's step-4 primary.
 */
const WizardTopBar: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <View accessibilityLabel={m.topBarLabel} style={styles.topBar}>
            <Button
                variant="secondary"
                icon={<Feather name="eye" size={16} color={palette.charcoal} />}
                onPress={model.togglePreview}
            >
                {m.preview}
            </Button>
            <WizardActionsMenu />
        </View>
    );
};

/**
 * The footer — the ONE contextual primary (U6). Left: a secondary `Prev: {name}` once past step 1. Right: a
 * single filled primary that is `Next: {name}` on steps 1–3 (advances via `requestGoNext`) and swaps to
 * `Publish` on step 4 (submits via `requestPublish`, busies while submitting). Never more than two buttons.
 */
const WizardControls: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const f = useMessages(recipeFormMessages);
    const index = model.step - 1;
    const prevName = index > 0 ? m.stepNames[index - 1] : undefined;
    const nextName = index < WIZARD_TOTAL_STEPS - 1 ? m.stepNames[index + 1] : undefined;
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
                {prevName !== undefined ? (
                    <Button
                        variant="secondary"
                        icon={<Feather name="chevron-left" size={16} color={palette.charcoal} />}
                        onPress={model.requestGoPrev}
                    >
                        {fillTemplate(m.prevLabel, { name: prevName })}
                    </Button>
                ) : (
                    <View />
                )}
                {nextName !== undefined ? (
                    <Button
                        icon={<Feather name="chevron-right" size={16} color={palette.white} />}
                        onPress={model.requestGoNext}
                    >
                        {fillTemplate(m.nextLabel, { name: nextName })}
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

/** The 4-step recipe-edit wizard shell: `<Wizard>` plus its `.Step`/`.Rail`/`.TopBar`/`.Controls` parts. */
export const Wizard = Object.assign(WizardRoot, {
    Step: WizardStep,
    Rail: WizardRail,
    TopBar: WizardTopBar,
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
    topBar: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: palette.white,
        borderBottomWidth: 1,
        borderBottomColor: border,
    },
    controls: { gap: 4 },
    blockedNotice: { gap: 2, paddingHorizontal: 16, paddingTop: 12 },
    blockedText: { fontSize: 13, color: palette['error-dark'] },
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    menuTrigger: {
        minHeight: 44,
        minWidth: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: palette.white,
    },
    menuBackdrop: {
        flex: 1,
        alignItems: 'flex-end',
        paddingTop: 64,
        paddingHorizontal: 16,
        backgroundColor: 'rgba(44, 62, 80, 0.2)',
    },
    menuSheet: {
        minWidth: 200,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 8,
        gap: 4,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    menuItemDisabled: { opacity: 0.6 },
    menuItemLabel: { fontSize: 15, fontWeight: '500', color: palette.charcoal },
    menuItemDestructiveLabel: { fontSize: 15, fontWeight: '500', color: palette['error-dark'] },
    previewBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(44, 62, 80, 0.4)',
        padding: 16,
    },
    previewCard: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 20,
        gap: 10,
    },
    previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    previewLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    previewValue: { fontSize: 13, color: palette.charcoal, flexShrink: 1, textAlign: 'right' },
});
