/**
 * `runSeed.sh run` — the catalog seed step's impure half (curated catalog plan U2, R37, R38).
 *
 * The script digests the seed bundle the pipeline built, resolves the seed function from its stack's own output,
 * invokes `apply` with that digest, and classifies the answer through `runMigrations.sh`'s one definition of a
 * successful pipeline invoke.
 *
 * - **Real**: the script as `bash` in a child process, the bundle on disk, `jq`, the exit paths.
 * - **Stubbed**: the AWS CLI (`tests/common/pipelineLambdaAwsStub.ts`), the one seam where the script reaches out.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSeedManifest } from '@kitchensink/db-schema-guard';

import { pipelineLambdaAwsStub, type PipelineLambdaAwsStub } from './common/pipelineLambdaAwsStub.js';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/runSeed.sh', import.meta.url));
const STACK = 'kitchensink-food-schema-prod';
const OUTPUT = 'FoodSeedFunctionName';

let aws: PipelineLambdaAwsStub;
let bundle: string;

beforeEach(() => {
    aws = pipelineLambdaAwsStub();
    bundle = mkdtempSync(join(tmpdir(), 'seedBundle-'));
    mkdirSync(join(bundle, 'data'));
    writeFileSync(join(bundle, 'handler.js'), 'export const handler = () => 1;\n');
    writeFileSync(join(bundle, 'data', 'curatedCatalog.jsonl'), '{"key":"apple"}\n');
});

afterEach(() => {
    aws.cleanup();
    rmSync(bundle, { recursive: true, force: true });
});

const run = (args: readonly string[], environment: Readonly<Record<string, string>> = {}) =>
    aws.run(SCRIPT, ['run', 'us-east-1', STACK, OUTPUT, 'food', ...args], environment);

describe('run — resolves, invokes apply with the bundle’s digest, and reads the answer', () => {
    it('sends exactly `{ action: "apply", expectSeedSha }`, the digest of the bundle it was given', () => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'kitchensink-food-seed-prod' }]);

        const result = run([bundle], { STUB_INVOKE_PAYLOAD: '{"planned":0,"verified":true}' });

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(JSON.parse(aws.sentPayload() ?? '')).toStrictEqual({
            action: 'apply',
            expectSeedSha: readSeedManifest(bundle).sha,
        });
        expect(result.stdout).toMatch(/invoking seed function kitchensink-food-seed-prod/u);
    });

    it('⛔ makes ONE invoke that reads past Lambda’s maximum and pages nothing', () => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        run([bundle], { STUB_INVOKE_PAYLOAD: '{}' });

        const args = aws.sentArgs();

        expect(args[args.indexOf('--cli-read-timeout') + 1]).toBe('960');
        expect(args[args.indexOf('--cli-connect-timeout') + 1]).toBe('10');
        expect(args).toContain('--no-cli-pager');
        expect(aws.sentMaxAttempts()).toBe('1');
    });

    it.each([
        ['the function threw', { STUB_FUNCTION_ERROR: 'Unhandled', STUB_INVOKE_PAYLOAD: '{"errorType":"Error"}' }],
        ['the payload carries an errorType', { STUB_INVOKE_PAYLOAD: '{"errorType":"SeedVerifierError"}' }],
        ['the payload is empty', { STUB_INVOKE_PAYLOAD: '' }],
    ] as const)('⛔ FAILS when %s — a seed failure fails the deploy (R37)', (_case, environment) => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = run([bundle], environment);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/::error::/u);
    });
});

describe('run — when the CLI itself fails', () => {
    it('⛔ FAILS, and puts the CLI’s own reason in the log', () => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = run([bundle], { STUB_INVOKE_FAIL: 'Could not connect to the endpoint URL' });

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/::error::.*InvokeFailed/u);
        expect(result.stderr).toMatch(/aws lambda invoke failed: Could not connect to the endpoint URL/u);
    });
});

describe('run — what it does before, and instead of, an invoke', () => {
    it('⛔ FAILS before any lookup when the bundle does not exist — a bad path is never a skip', () => {
        const result = run([join(bundle, 'absent')]);

        expect(result.status).toBe(1);
        expect(aws.calls()).toStrictEqual([]);
    });

    it('SKIPS with a stated notice, and invokes nothing, when the stack does not exist', () => {
        const result = run([bundle]);

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/::notice::.*no schema of ours to seed/u);
        expect(aws.calls()).toStrictEqual(['cloudformation describe-stacks']);
    });

    it('⛔ FAILS, invoking nothing, when the stack could not be asked about', () => {
        const result = run([bundle], {
            STUB_DESCRIBE_ERROR: 'An error occurred (AccessDenied)',
            STUB_DESCRIBE_STATUS: '255',
        });

        expect(result.status).toBe(1);
        expect(aws.calls()).toStrictEqual(['cloudformation describe-stacks']);
    });

    it('⛔ FAILS when the stack publishes no seed function output', () => {
        aws.givenStack(STACK, [{ OutputKey: 'SomethingElse', OutputValue: 'x' }]);

        const result = run([bundle]);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/publishes no 'FoodSeedFunctionName' output/u);
    });
});
