/**
 * @module @commise/features-recipes/wizard — native 4-step recipe-edit wizard SHELL (w3/e1,e2, P8). The
 * React Native leaf of {@link import('./Wizard.js').Wizard} — same compound-component shape (Root + Context
 * + `useWizardModel()` + `Object.assign` parts), same navigation statechart (attempted steps, discard guard,
 * preview toggle); see that module's doc for the full rationale, including why `Wizard.TopBar` and
 * `Wizard.Controls` are deliberately two separate parts rather than the plan's literal single "Controls".
 *
 * **Native adaptation (per the plan):** `Wizard.Rail` collapses to a horizontally scrollable pill row plus
 * "Step N of 4"; `Wizard.Step` bodies are full-screen (the composing screen wraps its `Wizard.Step` content
 * in its own `ScrollView`, exactly as `RecipeForm.native.tsx` already does for the flat form); `Wizard.TopBar`
 * is a sticky header row the composing screen places above the scrolling step content.
 */
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import { createContext, useContext, useState, type FC, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import type { RecipeFormErrors, RecipeFormValues, RecipeWizardStep } from '../form/model.js';
import { deriveRailStepState, WIZARD_STEPS, WIZARD_TOTAL_STEPS } from './model.js';
import { wizardMessages } from './messages.js';

/** Props for {@link Wizard} (Root) — identical contract to the web leaf. */
export interface WizardProps {
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
    const { step, isDirty, onCancel, goNext, goPrev, goToStep, publish, children } = props;
    const m = useMessages(wizardMessages);
    const [attempted, setAttempted] = useState<ReadonlySet<RecipeWizardStep>>(new Set());
    const [previewOpen, setPreviewOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const markAttempted = (target: RecipeWizardStep): void =>
        setAttempted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));

    const requestGoNext = (): void => {
        markAttempted(step);
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
        publish();
    };

    const togglePreview = (): void => setPreviewOpen((open) => !open);

    const model: WizardModel = {
        ...props,
        attempted,
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

const RAIL_MARKER_TEXT_COLOR: Record<RailState, string> = {
    completed: palette.white,
    current: palette.seafoam,
    invalid: palette.white,
    upcoming: palette.slate,
};

/** The step-rail: a horizontally scrollable pill row + "Step N of 4" (native adaptation of FR-044). */
const WizardRail: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <View accessibilityLabel={m.railLabel} style={styles.railContainer}>
            <Text style={styles.railProgress}>
                {fillTemplate(m.stepProgress, { current: model.step, total: WIZARD_TOTAL_STEPS })}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railScroll}>
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
            </ScrollView>
        </View>
    );
};

/** The sticky top bar: Save Draft · Preview · Cancel + Publish — FR-002. */
const WizardTopBar: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const publishLabel = model.mode === 'create' ? m.publishCreate : m.publishEdit;

    return (
        <View accessibilityLabel={m.topBarLabel} style={styles.topBar}>
            <Button
                variant="secondary"
                icon={<Feather name="save" size={16} color={palette.charcoal} />}
                busy={model.submitting}
                onPress={model.saveDraft}
            >
                {m.saveDraft}
            </Button>
            <Button
                variant="secondary"
                icon={<Feather name="eye" size={16} color={palette.charcoal} />}
                onPress={model.togglePreview}
            >
                {m.preview}
            </Button>
            <Button
                variant="secondary"
                icon={<Feather name="x" size={16} color={palette.charcoal} />}
                onPress={model.requestCancel}
            >
                {m.cancel}
            </Button>
            <Button
                icon={<Feather name="check" size={16} color={palette.white} />}
                busy={model.submitting}
                onPress={model.requestPublish}
            >
                {publishLabel}
            </Button>
        </View>
    );
};

/** The footer step nav: `< Prev: {name}` / `Next: {name} >`. */
const WizardControls: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const index = model.step - 1;
    const prevName = index > 0 ? m.stepNames[index - 1] : undefined;
    const nextName = index < WIZARD_TOTAL_STEPS - 1 ? m.stepNames[index + 1] : undefined;

    return (
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
            {nextName !== undefined && (
                <Button
                    icon={<Feather name="chevron-right" size={16} color={palette.white} />}
                    onPress={model.requestGoNext}
                >
                    {fillTemplate(m.nextLabel, { name: nextName })}
                </Button>
            )}
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
    railScroll: { flexDirection: 'row', gap: 16, paddingBottom: 8 },
    railPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    railMarker: {
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
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
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
