/**
 * `@radicle-co/infra-shared/recipe-queues` — the identity of the three queues `recipe-service` produces onto
 * and `recipe-workers` consumes from.
 *
 * @module
 */
export {
    RECIPE_QUEUE_KINDS,
    recipeQueueArn,
    recipeQueueDlqName,
    recipeQueueName,
    recipeQueueUrl,
    type RecipeQueueKind,
} from './recipeQueues.js';
