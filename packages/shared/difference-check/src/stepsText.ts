/**
 * @module @kitchensink/difference-check: the ONE join of a recipe's steps into the text the check, the stored baseline and
 * the hash all read (KTD-1). A second join would make the hash of a text differ from the text that was checked.
 *
 * Pure.
 */

/** A step as far as the check reads it: its instruction. */
export interface StepInstruction {
    readonly instruction: string;
}

/**
 * The steps text: the instructions joined with a newline, in the order given.
 *
 * @param steps - The steps, in step order.
 * @returns The text, empty for no steps.
 */
export function stepsTextOf(steps: readonly StepInstruction[]): string {
    return steps.map((step) => step.instruction).join('\n');
}
