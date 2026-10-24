/**
 * The CI roles' observe grants must equal the AWS calls the CI files actually make.
 *
 * `GithubActionsAccessStack.test.ts` requires each role's observe actions to equal the command table
 * (`ciAwsCommands.ts`). This guard closes the other half: the table must equal what the CI-reachable SOURCE calls,
 * found by scanning it, so a call nobody listed (a Node tool shelling the CLI through `execFile`, a new `wait`)
 * fails here with the file and line that runs it. A hand-kept list cannot detect its own incompleteness.
 *
 * Two parts: fixtures that prove the guard's logic fails when it should (the mutation lens), then the real tree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { coverageFindings, languageOf, type CoverageFile, type SdkOnlyDeclaration } from './awsCliObserveCoverage.js';
import { TEARDOWN, observeCommands } from './ciAwsCommands.js';
import { repoRoot } from './serviceSources.js';

const rows = (...actions: string[]): readonly { caller: string; action: string }[] =>
    actions.map((action) => ({ caller: `row for ${action}`, action }));

const file = (name: string, contents: string): CoverageFile => ({ file: name, contents });

const run = (
    files: readonly CoverageFile[],
    actions: readonly string[],
    teardown: readonly string[] = [],
    sdkOnly: Readonly<Record<string, SdkOnlyDeclaration>> = {},
): readonly string[] => coverageFindings({ files, rows: rows(...actions), teardown: new Set(teardown), sdkOnly });

describe('coverageFindings: the guard fails when the table and the source disagree', () => {
    it('is quiet when every call is listed and every row is called', () => {
        expect(run([file('a.sh', 'aws ecs list-tasks')], ['ecs:ListTasks'])).toEqual([]);
    });

    it('names the file and line of a shell call that no row lists', () => {
        const findings = run([file('.github/scripts/x.sh', 'echo hi\naws sns get-topic-attributes --topic-arn t')], []);

        expect(findings).toEqual([expect.stringContaining('missing: .github/scripts/x.sh:2')]);
        expect(findings[0]).toContain('sns:GetTopicAttributes');
    });

    it('names a Node tool that shells the CLI through execFile (the collectMetrics miss)', () => {
        const source = `const args = ['cloudwatch', 'get-metric-statistics', '--region', R];\nawait execFileAsync('aws', args);`;
        const findings = run([file('packages/tools/loadtest/observe/collectMetrics.mjs', source)], []);

        expect(findings).toEqual([
            expect.stringContaining('missing: packages/tools/loadtest/observe/collectMetrics.mjs:2'),
        ]);
        expect(findings[0]).toContain('cloudwatch:GetMetricStatistics');
    });

    it('names the waiter a `wait` polls', () => {
        const findings = run([file('a.sh', 'aws ecs wait services-stable --cluster c')], []);

        expect(findings[0]).toContain('ecs:DescribeServices');
    });

    it('reports a call it cannot read instead of skipping it', () => {
        const findings = run([file('a.sh', 'aws "$SERVICE" describe-things')], []);

        expect(findings).toEqual([expect.stringContaining('unreadable: a.sh:1')]);
    });

    it('reports a waiter it has no mapping for on an observe service', () => {
        const findings = run([file('a.sh', 'aws ecs wait something-new --cluster c')], []);

        expect(findings).toEqual([expect.stringContaining('unreadable: a.sh:1')]);
    });

    it('does not ask for a row for a service the roles do not observe', () => {
        expect(run([file('a.sh', 'aws lambda invoke --function-name f out.json\naws s3 cp a b')], [])).toEqual([]);
    });

    it('accepts a teardown verb that is in the teardown set and rejects one that is not', () => {
        const source = 'aws ecs delete-service --cluster c --service s';

        expect(run([file('a.sh', source)], [], ['ecs:DeleteService'])).toEqual([]);
        expect(run([file('a.sh', source)], [], [])).toEqual([expect.stringContaining('ecs:DeleteService')]);
    });

    it('compares actions case-insensitively, as IAM does', () => {
        expect(run([file('a.sh', 'aws rds describe-db-instances')], ['rds:DescribeDbInstances'])).toEqual([]);
    });

    it('names the caller of a STALE row that no file calls', () => {
        const findings = run([file('a.sh', 'aws ecs list-tasks')], ['ecs:ListTasks', 'ecs:ListClusters']);

        expect(findings).toEqual([expect.stringContaining('stale: the row "row for ecs:ListClusters"')]);
    });

    it('names a stale teardown action', () => {
        const findings = run([file('a.sh', 'aws ecs list-tasks')], ['ecs:ListTasks'], ['ecs:StopTask']);

        expect(findings).toEqual([expect.stringContaining('stale: the teardown set names ecs:StopTask')]);
    });

    it('lets an SDK-only action stand when its file constructs the command', () => {
        const sdk = { 'sqs:GetQueueUrl': { file: 'svc.ts', command: 'GetQueueUrlCommand' } };
        const files = [file('a.sh', 'aws ecs list-tasks'), file('svc.ts', 'new GetQueueUrlCommand({})')];

        expect(run(files, ['ecs:ListTasks', 'sqs:GetQueueUrl'], [], sdk)).toEqual([]);
    });

    it('rejects an SDK-only declaration whose file is absent, silent, or contradicted by a CLI call', () => {
        const sdk = { 'sqs:GetQueueUrl': { file: 'svc.ts', command: 'GetQueueUrlCommand' } };

        expect(run([], ['sqs:GetQueueUrl'], [], sdk)).toEqual([expect.stringContaining('not in the scanned set')]);
        expect(run([file('svc.ts', 'nothing')], ['sqs:GetQueueUrl'], [], sdk)).toEqual([
            expect.stringContaining('never mentions GetQueueUrlCommand'),
        ]);
        expect(
            run(
                [file('svc.ts', 'GetQueueUrlCommand'), file('a.sh', 'aws sqs get-queue-url')],
                ['sqs:GetQueueUrl'],
                [],
                sdk,
            ),
        ).toEqual([expect.stringContaining('through the CLI')]);
    });

    it('does not scan a file type it cannot read', () => {
        expect(languageOf('README.md')).toBeUndefined();
        expect(languageOf('a.yml')).toBe('shell');
        expect(languageOf('a.mjs')).toBe('script');
        expect(languageOf('packages/services/identity/package.json')).toBe('shell');
        expect(languageOf('tsconfig.json')).toBeUndefined();
    });
});

/**
 * Files whose AWS calls the CI roles never make, each with the reason. The scan covers every tracked source file, so
 * the only way out is a row here.
 */
const EXCLUDED: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
    {
        pattern: /^packages\/tools\/local-sandbox\//u,
        reason: "runs on a developer machine with that developer's own credentials, never under a CI role",
    },
    {
        pattern: /^packages\/services\/identity\/infra\/scripts\/localstackBootstrap\.sh$/u,
        reason: 'bootstraps LocalStack (--endpoint-url, dummy credentials) for local development; no workflow runs it',
    },
    {
        pattern: /\.integration\.test\.ts$/u,
        reason: 'the integration tier mocks AWS: it writes a stub `aws` binary first on PATH and calls no real API',
    },
    {
        pattern: /(^|\/)__tests__\//u,
        reason: 'unit tests hold commands as fixture text and run no AWS call',
    },
    {
        pattern: /^docs\/|^specs\/|^\.local-sandbox\//u,
        reason: 'documentation and local scratch, not executed by a workflow',
    },
];

/** Actions CI makes through an SDK client rather than the CLI, with the file that makes each. */
const SDK_ONLY: Readonly<Record<string, SdkOnlyDeclaration>> = {};

const trackedFiles = (): readonly string[] =>
    execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n')
        .filter((name) => name !== '' && existsSync(path.join(repoRoot, name)));

describe('CI roles: the observe command table equals what the CI-reachable source calls', () => {
    const scanned = trackedFiles().filter(
        (name) => languageOf(name) !== undefined && !EXCLUDED.some(({ pattern }) => pattern.test(name)),
    );
    const env = { account: '123456789012', region: 'us-east-1' };

    it('scans the CI surface (a vacuous scan would pass anything)', () => {
        expect(scanned).toContain('.github/scripts/ecsQuiesce.sh');
        expect(scanned).toContain('packages/tools/loadtest/observe/collectMetrics.mjs');
        expect(scanned.length).toBeGreaterThan(200);
    });

    it('gives every exclusion a reason and a pattern that excludes something', () => {
        const all = trackedFiles();

        for (const { pattern, reason } of EXCLUDED) {
            expect(reason.length).toBeGreaterThan(20);
            expect(
                all.some((name) => pattern.test(name)),
                String(pattern),
            ).toBe(true);
        }
    });

    it('has no missing, unreadable or stale command', () => {
        const files = scanned.map((name) => file(name, readFileSync(path.join(repoRoot, name), 'utf8')));
        const commands = observeCommands(env);
        const findings = coverageFindings({
            files,
            rows: commands.map(([caller, action]) => ({ caller, action })),
            teardown: TEARDOWN,
            sdkOnly: SDK_ONLY,
        });

        expect(findings).toEqual([]);
    });
});
