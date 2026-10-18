/**
 * Print the queues this stage's recipe API produces onto, DERIVED from the shared authority (ADR-0036).
 *
 * `ecosystem-smoke` runs this to learn what to verify - the queue's name (to ask SQS for it), its derived URL, and
 * the environment variable the running task carries it in - so the workflow restates none of them. Usage:
 * `tsx printRecipeQueues.ts <stage> <region> <account>`; one tab-separated line per queue.
 *
 * @module
 */
import { fileURLToPath } from 'node:url';

import {
    RECIPE_QUEUE_KINDS,
    recipeQueueName,
    recipeQueueUrl,
    type RecipeQueueKind,
} from '@radicle-co/infra-shared/recipe-queues';

/** The environment variable `RecipeServiceStack` puts each queue's URL in. */
export const QUEUE_ENV_VARS: Readonly<Record<RecipeQueueKind, string>> = {
    accountErasure: 'ACCOUNT_ERASURE_QUEUE_URL',
    ingredientVerification: 'INGREDIENT_VERIFICATION_QUEUE_URL',
    parse: 'RECIPE_PARSE_QUEUE_URL',
};

/** One queue's derived facts. */
export interface QueueRow {
    readonly kind: RecipeQueueKind;
    /** A kebab label for log lines. */
    readonly label: string;
    readonly name: string;
    readonly url: string;
}

/**
 * The derived facts for every queue. Pure.
 *
 * @param stage - The deploy stage.
 * @param region - The AWS region.
 * @param account - The AWS account id.
 * @returns One row per {@link RECIPE_QUEUE_KINDS} entry.
 */
export function recipeQueueRows(stage: string, region: string, account: string): readonly QueueRow[] {
    return RECIPE_QUEUE_KINDS.map((kind) => ({
        kind,
        label: kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        name: recipeQueueName(kind, stage),
        url: recipeQueueUrl(kind, stage, region, account),
    }));
}

/**
 * The rows as the lines this program prints. Pure.
 *
 * @param rows - From {@link recipeQueueRows}.
 * @returns `label<TAB>name<TAB>url<TAB>ENV_VAR`, newline-separated.
 */
export function formatRows(rows: readonly QueueRow[]): string {
    return rows.map((row) => [row.label, row.name, row.url, QUEUE_ENV_VARS[row.kind]].join('\t')).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [stage, region, account] = process.argv.slice(2);

    if (!stage || !region || !account) {
        console.error('usage: printRecipeQueues.ts <stage> <region> <account>');
        process.exitCode = 2;
    } else {
        console.log(formatRows(recipeQueueRows(stage, region, account)));
    }
}
