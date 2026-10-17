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

describe('describe — reads the two digests, never fails the step, and annotates nothing', () => {
    const DIGEST = 'a'.repeat(64);
    const OTHER = 'b'.repeat(64);
    const describeSeed = (environment: Readonly<Record<string, string>> = {}) =>
        aws.run(SCRIPT, ['describe', 'us-east-1', STACK, OUTPUT, 'food'], environment);
    const payload = (assetSha: unknown, ledgerSha: unknown): string =>
        JSON.stringify({ action: 'describe', assetSha, ledgerSha });

    it('reads current when the asset and the ledger hold the same digest', () => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = describeSeed({ STUB_INVOKE_PAYLOAD: payload(DIGEST, DIGEST) });

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/^seed=current$/mu);
    });

    it('sends exactly `{ action: "describe" }`, with a short read timeout and one attempt', () => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        describeSeed({ STUB_INVOKE_PAYLOAD: payload(DIGEST, DIGEST) });

        const args = aws.sentArgs();

        expect(JSON.parse(aws.sentPayload() ?? '')).toStrictEqual({ action: 'describe' });
        expect(args[args.indexOf('--cli-read-timeout') + 1]).toBe('60');
        expect(aws.sentMaxAttempts()).toBe('1');
    });

    it.each<[string, Readonly<Record<string, string>>]>([
        ['the digests differ', { STUB_INVOKE_PAYLOAD: payload(DIGEST, OTHER) }],
        ['the database was never seeded', { STUB_INVOKE_PAYLOAD: payload(DIGEST, null) }],
        ['a digest is not 64 hex characters', { STUB_INVOKE_PAYLOAD: payload('x', 'x') }],
        ['the payload is not a description', { STUB_INVOKE_PAYLOAD: '{"planned":0}' }],
        ['the function threw', { STUB_FUNCTION_ERROR: 'Unhandled', STUB_INVOKE_PAYLOAD: '{"errorType":"Error"}' }],
        ['the payload is empty', { STUB_INVOKE_PAYLOAD: '' }],
        ['the CLI could not invoke', { STUB_INVOKE_FAIL: 'Could not connect to the endpoint URL' }],
    ])('reads stale when %s, and still exits 0', (_case, environment) => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = describeSeed(environment);

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/^seed=stale$/mu);
        expect(result.stdout).toMatch(/^reason=.+$/mu);
        expect(result.stdout).not.toMatch(/::error::/u);
    });

    it('reads stale, invoking nothing, when the stack publishes no seed function output', () => {
        aws.givenStack(STACK, [{ OutputKey: 'SomethingElse', OutputValue: 'x' }]);

        const result = describeSeed();

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/^seed=stale$/mu);
        expect(result.stdout).not.toMatch(/::error::/u);
        expect(aws.calls()).toStrictEqual(['cloudformation describe-stacks']);
    });

    it('reads stale when the stack could not be asked about', () => {
        const result = describeSeed({
            STUB_DESCRIBE_ERROR: 'An error occurred (AccessDenied)',
            STUB_DESCRIBE_STATUS: '255',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/^seed=stale$/mu);
        expect(result.stdout).not.toMatch(/::error::/u);
    });

    it('reads absent, invoking nothing, when the stack does not exist', () => {
        const result = describeSeed();

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/^seed=absent$/mu);
        expect(result.stdout).not.toMatch(/::(error|notice)::/u);
        expect(aws.calls()).toStrictEqual(['cloudformation describe-stacks']);
    });

    it('exits 2 on misuse', () => {
        expect(aws.run(SCRIPT, ['describe', 'us-east-1'], {}).status).toBe(2);
    });
});

describe('run — logs its own noun, not the migrate step’s', () => {
    it('says the catalog seed ran clean, never that migrations did', () => {
        aws.givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = run([bundle], { STUB_INVOKE_PAYLOAD: '{"outcome":"applied"}' });

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/\[food\] catalog seed ran clean/u);
        expect(result.stdout).not.toMatch(/migrations ran clean/u);
    });
});
