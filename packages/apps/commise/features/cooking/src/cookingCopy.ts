import { fillTemplate } from '@commise/i18n';
import { stepPlace } from '@kitchensink/cooking-core';
import type { CookingStep } from '@kitchensink/cooking-core';

import type { CookingNavMessages } from './messages.js';

/** One of the two controls of the pair at the foot of a step. */
export interface CookingNavControl {
    readonly label: string;
    /** The accessible name: it names the step the control goes to. */
    readonly a11yName: string;
}

/** The forward control: which action it is, and whether it is the filled one now. */
export interface CookingForwardControl extends CookingNavControl {
    readonly kind: 'next' | 'finish' | 'startStep';
    /** Filled when it is the action now. Next is never filled (owner ruling C2). */
    readonly filled: boolean;
}

/** The Back and Next pair for one step. */
export interface CookingNav {
    readonly back: CookingNavControl;
    readonly forward: CookingForwardControl;
}

/** What the pair is decided from. */
export interface NavInput {
    /** The 0-based index of the current step. */
    readonly stepIndex: number;
    /** The steps the cook walks. */
    readonly steps: readonly CookingStep[];
    /** Whether every line of the current step is ticked. */
    readonly everyLineTicked: boolean;
    /** The navigation copy. */
    readonly copy: CookingNavMessages;
}

/**
 * The Back and Next pair for a step: Back always says "Back", and names the recipe on step 1 or
 * the step it goes to. Forward is a quiet Next step while lines are unticked, a filled Start step n once every line is
 * ticked, and Finish on the last step (quiet until every line is ticked, then filled).
 *
 * @param input - The step, the steps, the tick state and the copy.
 * @returns The two controls. Pure.
 * @throws {InvalidStepIndexError} When `stepIndex` is not a step.
 */
export function navOf({ stepIndex, steps, everyLineTicked, copy }: NavInput): CookingNav {
    const place = stepPlace(stepIndex, steps);
    const back: CookingNavControl = {
        label: copy.back,
        a11yName: place.previous === null ? copy.backA11yRecipe : fillTemplate(copy.backA11y, { n: place.previous }),
    };

    if (place.next === null) {
        return {
            back,
            forward: { kind: 'finish', label: copy.finish, a11yName: copy.finish, filled: everyLineTicked },
        };
    }

    if (everyLineTicked) {
        const label = fillTemplate(copy.startStep, { n: place.next });

        return { back, forward: { kind: 'startStep', label, a11yName: label, filled: true } };
    }

    return {
        back,
        forward: {
            kind: 'next',
            label: copy.next,
            a11yName: fillTemplate(copy.nextA11y, { n: place.next }),
            filled: false,
        },
    };
}
