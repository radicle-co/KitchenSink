'use client';

/**
 * @module @commise/features-recipes — the native recipe page's instructions section: the heading, the owner's Edit
 * action and the step rows (or the empty state).
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { DetailEmptySection } from './DetailEmptySection.native.js';
import { DetailHeadingRow, DetailSection, DetailSectionHeading } from './detailFrames.native.js';
import { detailStyles as styles } from './detailStyles.native.js';
import type { RecipeDetailBodyNativeProps } from './model.js';
import { StepRow } from './StepRow.native.js';

/** Props for {@link DetailInstructionsSection}. */
export interface DetailInstructionsSectionProps {
    readonly steps: RecipeDetailBodyNativeProps['recipe']['steps'];
    readonly marks: RecipeDetailBodyNativeProps['marks'];
    /** The owner's Edit action; absent when the viewer cannot edit. */
    readonly onEdit: (() => void) | undefined;
}

/** The native instructions section. */
export const DetailInstructionsSection: FC<DetailInstructionsSectionProps> = ({ steps, marks, onEdit }) => {
    const { detail } = useMessages(recipeMessages);

    return (
        <DetailSection>
            {/* The owner's Edit: a ghost link at the end of the heading row (§6.1, F22). */}
            <DetailHeadingRow>
                <DetailSectionHeading>{detail.instructionsHeading}</DetailSectionHeading>
                {onEdit !== undefined && steps.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="pencilLine"
                        accessibilityLabel={detail.editStepsLabel}
                        onPress={onEdit}
                    >
                        {detail.editSection}
                    </Button>
                )}
            </DetailHeadingRow>
            {steps.length === 0 ? (
                <DetailEmptySection text={detail.noSteps} actionLabel={detail.addSteps} onAction={onEdit} />
            ) : (
                <View style={styles.steps}>
                    {steps.map((step) => (
                        <StepRow
                            key={step.stepNumber}
                            step={step}
                            current={marks.currentStep === step.stepNumber}
                            onToggle={marks.toggleStep}
                        />
                    ))}
                </View>
            )}
        </DetailSection>
    );
};
