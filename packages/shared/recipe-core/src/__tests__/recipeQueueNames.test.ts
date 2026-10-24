/**
 * The recipe queue identities, proven from the contract: a queue's NAME, ARN and URL are a pure function of the
 * stage, region and account, so the stack that CONSUMES a queue and the stack that PRODUCES onto it can never
 * disagree about which queue they mean (ADR-0036's reasoning for food's origin, applied to the three queues
 * `RecipeServiceStack` sends to).
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import {
    RECIPE_QUEUE_KINDS,
    recipeQueueArn,
    recipeQueueDlqName,
    recipeQueueName,
    recipeQueueUrl,
} from '../recipeQueueNames.js';

const REGION = 'us-east-1';
const ACCOUNT = '040663841500';

describe('recipeQueueName', () => {
    it.each([
        ['accountErasure', 'kitchensink-recipe-account-erasure-pr-73'],
        ['ingredientVerification', 'kitchensink-recipe-verification-pr-73'],
        ['parse', 'kitchensink-recipe-parse-pr-73'],
    ] as const)('names the %s queue for a stage', (kind, expected) => {
        expect(recipeQueueName(kind, 'pr-73')).toBe(expected);
    });

    it('gives every kind a distinct name at one stage, and one stage a distinct name per kind', () => {
        const stages = ['prod', 'sandbox', 'pr-7', 'pr-73'];
        const names = stages.flatMap((stage) => RECIPE_QUEUE_KINDS.map((kind) => recipeQueueName(kind, stage)));

        expect(RECIPE_QUEUE_KINDS).toHaveLength(3);
        expect(new Set(names).size).toBe(stages.length * RECIPE_QUEUE_KINDS.length);
    });

    it('stays inside the SQS 80 character limit for the longest stage the scheme admits', () => {
        for (const kind of RECIPE_QUEUE_KINDS) {
            expect(recipeQueueDlqName(kind, 'pr-999999').length).toBeLessThanOrEqual(80);
        }
    });
});

describe('recipeQueueDlqName', () => {
    it('is the queue name with the dead-letter infix, never equal to the queue', () => {
        expect(recipeQueueDlqName('accountErasure', 'sandbox')).toBe('kitchensink-recipe-account-erasure-dlq-sandbox');

        for (const kind of RECIPE_QUEUE_KINDS) {
            expect(recipeQueueDlqName(kind, 'sandbox')).not.toBe(recipeQueueName(kind, 'sandbox'));
        }
    });
});

describe('recipeQueueArn / recipeQueueUrl', () => {
    it('builds the ARN the account and region name', () => {
        expect(recipeQueueArn('accountErasure', 'pr-73', REGION, ACCOUNT)).toBe(
            'arn:aws:sqs:us-east-1:040663841500:kitchensink-recipe-account-erasure-pr-73',
        );
    });

    it('builds the URL SQS itself returns for that queue', () => {
        expect(recipeQueueUrl('parse', 'prod', REGION, ACCOUNT)).toBe(
            'https://sqs.us-east-1.amazonaws.com/040663841500/kitchensink-recipe-parse-prod',
        );
    });

    it('agrees with the name: the ARN and URL both END in recipeQueueName', () => {
        for (const kind of RECIPE_QUEUE_KINDS) {
            const name = recipeQueueName(kind, 'pr-9');

            expect(recipeQueueArn(kind, 'pr-9', REGION, ACCOUNT).endsWith(`:${name}`)).toBe(true);
            expect(recipeQueueUrl(kind, 'pr-9', REGION, ACCOUNT).endsWith(`/${name}`)).toBe(true);
        }
    });

    it('keeps one stage’s queue out of another’s (a pr-{N} service enqueues onto its OWN queue)', () => {
        expect(recipeQueueUrl('accountErasure', 'pr-73', REGION, ACCOUNT)).not.toBe(
            recipeQueueUrl('accountErasure', 'sandbox', REGION, ACCOUNT),
        );
    });
});
