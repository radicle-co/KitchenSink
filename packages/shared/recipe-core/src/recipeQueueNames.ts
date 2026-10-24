/**
 * THE identity of a recipe queue — name, ARN and URL — as a pure function of the stage, region and account.
 *
 * ## Why this is a function and not a published SSM parameter
 *
 * `RecipeServiceStack` sends to three queues that `RecipeWorkersStack` owns (account erasure, ingredient
 * verification, parse). It used to learn their URLs and ARNs from SSM parameters the workers stack published,
 * resolved at DEPLOY time — which made the service's deploy wait for the workers' deploy, an edge CloudFormation
 * cannot see and the pipeline therefore had to state. It put a serial slot on the longest chain in the preview
 * (parser → workers → service) for a fact that was never data: a queue's name is chosen by us, and its URL and
 * ARN follow from the name, the region and the account by AWS's own formats.
 *
 * This is ADR-0036's move for food's origin (`foodServiceOriginForStage`): derive the address with no network
 * and no ordering, and let the JOIN (`ecosystem-smoke`) assert that the thing at that address exists and is the
 * thing the consumer was configured with. The old guarantee — a stage wired with no queue fails loudly — is
 * kept there, not here: this function can name a queue that does not exist yet.
 *
 * ⛔ ONE authority. The workers stack names its queues with {@link recipeQueueName}, the service derives its
 * URL and grant with {@link recipeQueueUrl}/{@link recipeQueueArn}, and the smoke derives the same.
 *
 * ⚠️ The stage is the DEPLOY stage, never the base stage: a `pr-{N}` service enqueues onto the `pr-{N}` queue,
 * whose worker points at the `pr-{N}` logical database (ADR-0006). Draining a sandbox queue from a preview
 * would erase an owner out of the wrong database.
 *
 * ## Why it lives in `@kitchensink/recipe-core` and not in `@radicle-co/infra-shared`
 *
 * Both CDK apps already import their shared recipe facts from here (`database-name`, `parse-line-delivery`,
 * `spend-arithmetic`). `infra-shared` is a PUBLISHED package consumers pin by exact version, so a function placed
 * there reaches a consumer only after a prerelease is published and every pin is moved by a commit - and until then
 * a synth that imports it fails. This module is CDK-free and pure, so the workspace is the cheaper home.
 *
 * @module
 */

/** The queues `recipe-service` produces onto. The order is not significant. */
export const RECIPE_QUEUE_KINDS = ['accountErasure', 'ingredientVerification', 'parse'] as const;

/** One of {@link RECIPE_QUEUE_KINDS}. */
export type RecipeQueueKind = (typeof RECIPE_QUEUE_KINDS)[number];

/** The segment that names a kind inside a queue name — the names the deployed queues already carry. */
const KIND_SEGMENT: Readonly<Record<RecipeQueueKind, string>> = {
    accountErasure: 'account-erasure',
    ingredientVerification: 'verification',
    parse: 'parse',
};

/**
 * The queue's physical name for a stage.
 *
 * @param kind - Which queue.
 * @param stage - The deploy stage (`prod`, `sandbox`, `pr-{N}`).
 * @returns The SQS queue name. Pure, total.
 */
export function recipeQueueName(kind: RecipeQueueKind, stage: string): string {
    return `kitchensink-recipe-${KIND_SEGMENT[kind]}-${stage}`;
}

/**
 * The name of the dead-letter queue that backs {@link recipeQueueName}.
 *
 * @param kind - Which queue.
 * @param stage - The deploy stage.
 * @returns The SQS queue name. Pure, total.
 */
export function recipeQueueDlqName(kind: RecipeQueueKind, stage: string): string {
    return `kitchensink-recipe-${KIND_SEGMENT[kind]}-dlq-${stage}`;
}

/**
 * The queue's ARN.
 *
 * @param kind - Which queue.
 * @param stage - The deploy stage.
 * @param region - The AWS region (may be a CDK token).
 * @param account - The AWS account id (may be a CDK token).
 * @returns The ARN. Pure.
 */
export function recipeQueueArn(kind: RecipeQueueKind, stage: string, region: string, account: string): string {
    return `arn:aws:sqs:${region}:${account}:${recipeQueueName(kind, stage)}`;
}

/**
 * The queue's URL, in the form SQS returns it.
 *
 * @param kind - Which queue.
 * @param stage - The deploy stage.
 * @param region - The AWS region (may be a CDK token).
 * @param account - The AWS account id (may be a CDK token).
 * @returns The queue URL. Pure.
 */
export function recipeQueueUrl(kind: RecipeQueueKind, stage: string, region: string, account: string): string {
    return `https://sqs.${region}.amazonaws.com/${account}/${recipeQueueName(kind, stage)}`;
}
