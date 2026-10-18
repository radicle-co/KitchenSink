/**
 * `printRecipeQueues.ts` is how `ecosystem-smoke` learns the queue addresses it must verify: it prints the
 * DERIVED name, URL and task environment variable per queue, so the workflow restates none of them in YAML.
 * What matters is that it answers from the same authority the stack uses - a second spelling of "which queue is
 * the parse queue" in a shell script is the drift the shared module exists to prevent. (That the STACK puts
 * these URLs in these variables is asserted by `RecipeServiceStack.test.ts`, which reads the same names.)
 */
import { describe, expect, it } from 'vitest';

import { recipeQueueName, recipeQueueUrl } from '@radicle-co/infra-shared/recipe-queues';

import { QUEUE_ENV_VARS, formatRows, recipeQueueRows } from '../bin/printRecipeQueues.js';

describe('recipeQueueRows', () => {
    const rows = recipeQueueRows('pr-73', 'us-east-1', '123456789012');

    it('has one row per queue the API produces onto', () => {
        expect(rows.map((row) => row.label).sort()).toEqual(['account-erasure', 'ingredient-verification', 'parse']);
    });

    it('carries the name and URL the shared module derives, per kind', () => {
        for (const row of rows) {
            expect(row.url).toBe(recipeQueueUrl(row.kind, 'pr-73', 'us-east-1', '123456789012'));
            expect(row.name).toBe(recipeQueueName(row.kind, 'pr-73'));
        }
    });

    it('names the environment variables the recipe task carries', () => {
        expect(QUEUE_ENV_VARS).toEqual({
            accountErasure: 'ACCOUNT_ERASURE_QUEUE_URL',
            ingredientVerification: 'INGREDIENT_VERIFICATION_QUEUE_URL',
            parse: 'RECIPE_PARSE_QUEUE_URL',
        });
    });
});

describe('formatRows', () => {
    it('prints one tab-separated line per queue: label, queue name, URL, environment variable', () => {
        const lines = formatRows(recipeQueueRows('pr-73', 'us-east-1', '123456789012')).split('\n');

        expect(lines).toHaveLength(3);
        expect(lines).toContain(
            'parse\tkitchensink-recipe-parse-pr-73\thttps://sqs.us-east-1.amazonaws.com/123456789012/kitchensink-recipe-parse-pr-73\tRECIPE_PARSE_QUEUE_URL',
        );
    });
});
