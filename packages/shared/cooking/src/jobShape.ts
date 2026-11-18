/**
 * The shape of the job before step 1: the total, the prep and one row per step or run of steps.
 *
 * DESIGN PATTERN: Specification (`jobShapeOf` decides every wait, the form of the total and the rows from the one
 * reading {@link stepWaitsOf}), and a discriminated union with an exhaustive switch for the rows and the total.
 */
import { stepWaitsOf, type StepWaitsInput, type Wait } from './duration.js';

/** The rounding step of the total: it goes up to the next 5 minutes. */
const TOTAL_STEP_SECONDS = 300;

/** A step as the job shape reads it: its number, its stored timer and its lines. */
export interface JobStepInput extends StepWaitsInput {
    /** The recipe's number for the step. A step with no text is not in the list, so it is not the position. */
    readonly stepNumber: number;
}

/** The input to {@link jobShapeOf}. */
export interface JobShapeInput {
    /** The recipe's prep time. 0, below 0, absent or not a number mean no prep. */
    readonly prepTimeMinutes?: number | undefined;
    /** The cooking steps, in order. */
    readonly steps: readonly JobStepInput[];
}

/** One row of the job: a step with waits, a run of steps with no time, or a step the reader cannot read. */
export type JobRow =
    | { readonly kind: 'wait'; readonly stepNumber: number; readonly waits: readonly Wait[] }
    | { readonly kind: 'untimed'; readonly fromStep: number; readonly toStep: number }
    | { readonly kind: 'readStep'; readonly stepNumber: number };

/**
 * The total. `about` counts a wait for every step. `partial` leaves some step out. `noPrep` has waits but no prep, so
 * it gives no total. `noTimes` has neither prep nor a wait.
 */
export type JobTotal =
    | { readonly kind: 'about'; readonly seconds: number }
    | { readonly kind: 'partial'; readonly seconds: number }
    | { readonly kind: 'noPrep' }
    | { readonly kind: 'noTimes' };

/** The job: the prep, the total and the rows. */
export interface JobShape {
    /** The prep in seconds, or `undefined` for no prep. */
    readonly prepSeconds: number | undefined;
    readonly total: JobTotal;
    readonly rows: readonly JobRow[];
}

/** What one step is to the job, with the waits it counts. */
type StepClass =
    | { readonly kind: 'wait'; readonly waits: readonly Wait[] }
    | { readonly kind: 'untimed' }
    | { readonly kind: 'readStep' };

const classOf = (step: JobStepInput): StepClass => {
    const reading = stepWaitsOf(step);

    if (reading.kind === 'stored') {
        return { kind: 'wait', waits: [{ seconds: reading.seconds, offers: true }] };
    }

    if (reading.unread) {
        return { kind: 'readStep' };
    }

    return reading.waits.length > 0 ? { kind: 'wait', waits: reading.waits } : { kind: 'untimed' };
};

const prepSecondsOf = (prepTimeMinutes: number | undefined): number | undefined =>
    prepTimeMinutes !== undefined && Number.isFinite(prepTimeMinutes) && prepTimeMinutes > 0
        ? Math.round(prepTimeMinutes * 60)
        : undefined;

const roundedUp = (seconds: number): number => Math.ceil(seconds / TOTAL_STEP_SECONDS) * TOTAL_STEP_SECONDS;

/** A step with its class, so the number and the class cannot drift apart. */
interface ClassedStep {
    readonly stepNumber: number;
    readonly cls: StepClass;
}

const rowsOf = (classed: readonly ClassedStep[]): readonly JobRow[] => {
    const rows: JobRow[] = [];

    for (const { stepNumber, cls } of classed) {
        switch (cls.kind) {
            case 'wait':
                rows.push({ kind: 'wait', stepNumber, waits: cls.waits });
                break;
            case 'readStep':
                rows.push({ kind: 'readStep', stepNumber });
                break;

            case 'untimed': {
                const last = rows.at(-1);

                if (last?.kind === 'untimed') {
                    rows[rows.length - 1] = { kind: 'untimed', fromStep: last.fromStep, toStep: stepNumber };
                } else {
                    rows.push({ kind: 'untimed', fromStep: stepNumber, toStep: stepNumber });
                }

                break;
            }
        }
    }

    return rows;
};

/**
 * The shape of the job: what the cook sees before step 1.
 *
 * @param input - The prep time and the steps.
 * @returns The prep, the total and the rows. The total is the prep plus the low end of every counted wait, rounded up
 *   to 5 minutes, and it never reads the recipe's own total-time field. A step with a time the reader cannot read
 *   counts nothing, and a time over 24 hours is a wait that counts and offers no timer. Pure.
 */
export function jobShapeOf(input: JobShapeInput): JobShape {
    const classed = input.steps.map((step) => ({ stepNumber: step.stepNumber, cls: classOf(step) }));
    const classes = classed.map(({ cls }) => cls);
    const prepSeconds = prepSecondsOf(input.prepTimeMinutes);
    const counted = classes.flatMap((cls) => (cls.kind === 'wait' ? cls.waits : []));
    const rows = rowsOf(classed);

    if (prepSeconds === undefined) {
        return { prepSeconds, total: counted.length > 0 ? { kind: 'noPrep' } : { kind: 'noTimes' }, rows };
    }

    const seconds = roundedUp(counted.reduce((sum, wait) => sum + wait.seconds, prepSeconds));
    const every = classes.length > 0 && classes.every((cls) => cls.kind === 'wait');

    return { prepSeconds, total: { kind: every ? 'about' : 'partial', seconds }, rows };
}
