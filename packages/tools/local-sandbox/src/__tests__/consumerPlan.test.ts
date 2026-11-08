import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CONSUMER_PLAN_RELATIVE, readConsumerPlan, type PersistedConsumer } from '../queueConsumers.js';

const consumer: PersistedConsumer = {
    name: 'accountErasureWorker',
    handler: 'handler',
    bundleDir: '/bundle',
    module: 'index.js',
    exportName: 'handler',
    queueUrl: 'http://localhost:4566/000000000000/q',
    batchSize: 1,
    reportsBatchItemFailures: true,
    timeoutSeconds: 30,
    environment: { STAGE: 'local' },
};

const dir = mkdtempSync(path.join(tmpdir(), 'consumerPlan-'));

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

const planWith = (text: string): string => {
    const file = path.join(dir, 'plan.json');
    writeFileSync(file, text);

    return file;
};

describe('readConsumerPlan — the one reader of .local-sandbox/queueConsumers.json', () => {
    it('names the plan file relative to a checkout, once', () => {
        expect(CONSUMER_PLAN_RELATIVE).toBe('.local-sandbox/queueConsumers.json');
    });

    it('reads the consumers local:up persisted', () => {
        expect(readConsumerPlan(planWith(JSON.stringify([consumer])))).toEqual([consumer]);
    });

    it('names the file when it is missing, and says how to make it', () => {
        expect(() => readConsumerPlan(path.join(dir, 'absent.json'))).toThrow(/absent\.json.*local:up/su);
    });

    it('names the file when it is not JSON', () => {
        expect(() => readConsumerPlan(planWith('not json'))).toThrow(/plan\.json.*not JSON/su);
    });

    it('names the file and the field when a consumer is malformed', () => {
        const broken = { ...consumer, queueUrl: undefined };

        expect(() => readConsumerPlan(planWith(JSON.stringify([broken])))).toThrow(/plan\.json.*queueUrl/su);
    });

    it('refuses a plan that is not a list', () => {
        expect(() => readConsumerPlan(planWith('{}'))).toThrow(/plan\.json/u);
    });
});
