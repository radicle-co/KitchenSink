/**
 * Integration suite: every SSM-typed template parameter of a really synthesized stack is READABLE by the execution
 * role that deploys that stack.
 *
 * CloudFormation resolves an SSM-typed parameter (`AWS::SSM::Parameter::Value<String>`) with the stack's service role,
 * not with the deployer's credentials, before the change set exists. Every CDK stack has one (`BootstrapVersion`,
 * defaulting to `/cdk-bootstrap/<qualifier>/version`); stage stacks add `/kitchensink/<stage>/...`, a few
 * `/kitchensink/global/...` and the public AMI parameter. The first hand deploy of the account app failed at change-set
 * creation: "cdk-ksaccount-cfn-exec-role ... is not authorized to perform: ssm:GetParameters on
 * parameter/cdk-bootstrap/ksaccount/version". A policy table cannot see that; a synthesized template can.
 *
 * Coverage: the account app, and the global app at one stage per tier (`sandbox`, `pr-1` for ksnonprod, `prod` for
 * ksprod). The service apps (`packages/services/<service>/infra`) need their Lambda bundles built and are not
 * synthesized here; they read the same `/kitchensink/<stage>/...` family, which the global app's stacks also read.
 *
 * Judged against the RENDERED execution policies (all parts of the qualifier together): an Allow covers the ARN and no
 * Deny does. Nothing is stubbed and AWS is never contacted.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildExecutionPolicy } from '@kitchensink/cdk-bootstrap/executionPolicy';
import { iamLike } from '@kitchensink/cdk-bootstrap/iamPattern';
import { renderDocument, type PolicyDocument } from '@kitchensink/cdk-bootstrap/policyDocument';
import type { QualifierName } from '@kitchensink/cdk-bootstrap/qualifiers';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';

const environment = (stage: string, outdir: string): NodeJS.ProcessEnv => ({
    ...process.env,
    CDK_OUTDIR: outdir,
    STAGE: stage,
    DOMAIN_NAME: 'commise.app',
    CDK_DEFAULT_ACCOUNT: ACCOUNT,
    AWS_ACCOUNT_ID: ACCOUNT,
    CDK_DEFAULT_REGION: REGION,
    ALARMS_ENABLED: 'true',
    COST_ALERT_EMAIL: 'ci@example.com',
    CLERK_AUTHORIZED_PARTIES: 'https://commise.app',
    CLERK_AZP_PATTERN: '^https://pr-[0-9]+\\.sandbox\\.commise\\.app$',
    CLERK_AZP_PREVIEW_MODE: 'strict',
    CLERK_JWT_KEY:
        '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAfixture\n-----END PUBLIC KEY-----',
});

const scratch: string[] = [];

/** Runs one entrypoint at one stage and returns the default of every SSM-typed parameter of every stack it made. */
function ssmParameterDefaults(entrypoint: string, stage: string): string[] {
    const outdir = mkdtempSync(path.join(tmpdir(), 'ssmReadable-'));

    scratch.push(outdir);

    const result = spawnSync('npx', ['tsx', entrypoint], {
        cwd: packageDir,
        env: environment(stage, outdir),
        encoding: 'utf8',
        timeout: 200_000,
    });

    if (result.status !== 0) {
        throw new Error(`${entrypoint} @ ${stage} failed to synthesize:\n${result.stderr.slice(-1500)}`);
    }

    const defaults = new Set<string>();

    for (const file of readdirSync(outdir).filter((candidate) => candidate.endsWith('.template.json'))) {
        const template = JSON.parse(readFileSync(path.join(outdir, file), 'utf8')) as {
            Parameters?: Record<string, { Type?: string; Default?: string }>;
        };

        for (const parameter of Object.values(template.Parameters ?? {})) {
            if (parameter.Type?.startsWith('AWS::SSM::Parameter::Value') === true && parameter.Default !== undefined) {
                defaults.add(parameter.Default);
            }
        }
    }

    return [...defaults].sort();
}

/** The ARN IAM evaluates for `ssm:GetParameters` on a parameter path. A public (`/aws/service/...`) one has no account. */
const parameterArn = (parameterPath: string): string =>
    `arn:aws:ssm:${REGION}:${parameterPath.startsWith('/aws/service/') ? '' : ACCOUNT}:parameter${parameterPath}`;

const rendered = (qualifier: QualifierName): PolicyDocument[] =>
    buildExecutionPolicy(qualifier).map((part) => renderDocument(part.document, { account: ACCOUNT, region: REGION }));

/** Whether the qualifier's execution role, all parts together, may call `ssm:GetParameters` on the path. */
function readable(documents: readonly PolicyDocument[], parameterPath: string, action = 'ssm:GetParameters'): boolean {
    const arn = parameterArn(parameterPath);
    const covers = (effect: 'Allow' | 'Deny'): boolean =>
        documents.some((document) =>
            document.Statement.some(
                (statement) =>
                    statement.Effect === effect &&
                    (effect === 'Allow' || statement.Condition === undefined) &&
                    statement.Action.some((pattern) => iamLike(pattern.toLowerCase(), action.toLowerCase())) &&
                    statement.Resource.some((pattern) => iamLike(pattern, arn)),
            ),
        );

    return covers('Allow') && !covers('Deny');
}

const targets: ReadonlyArray<{ entrypoint: string; stage: string; qualifier: QualifierName }> = [
    { entrypoint: 'bin/account.ts', stage: 'prod', qualifier: 'ksaccount' },
    { entrypoint: 'bin/app.ts', stage: 'sandbox', qualifier: 'ksnonprod' },
    { entrypoint: 'bin/app.ts', stage: 'pr-1', qualifier: 'ksnonprod' },
    { entrypoint: 'bin/app.ts', stage: 'prod', qualifier: 'ksprod' },
];

const found: Record<string, string[]> = {};

beforeAll(() => {
    // The production edge stack refuses to synthesize without the bundle built with the same Clerk key.
    const bundle = spawnSync('node', ['esbuild.mjs'], {
        cwd: packageDir,
        env: environment('prod', ''),
        encoding: 'utf8',
        timeout: 200_000,
    });

    if (bundle.status !== 0) {
        throw new Error(`global bundle failed:\n${bundle.stderr.slice(-1500)}`);
    }

    for (const target of targets) {
        found[`${target.entrypoint}@${target.stage}`] = ssmParameterDefaults(target.entrypoint, target.stage);
    }
}, 600_000);

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe.each(targets)('$entrypoint @ $stage ($qualifier)', ({ entrypoint, stage, qualifier }) => {
    it('has SSM-typed parameters to judge, among them its own bootstrap version', () => {
        const defaults = found[`${entrypoint}@${stage}`] ?? [];

        expect(defaults).toContain(`/cdk-bootstrap/${qualifier}/version`);
    });

    it("lets the qualifier's execution role read every one of them", () => {
        const unreadable = (found[`${entrypoint}@${stage}`] ?? []).filter(
            (parameterPath) => !readable(rendered(qualifier), parameterPath),
        );

        expect(unreadable).toEqual([]);
    });
});

describe('the stage tiers read the parameters the live stacks carry that the global app does not', () => {
    it.each([
        ['ksnonprod', '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64'],
        ['ksprod', '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64'],
        ['ksnonprod', '/kitchensink/global/sentry/log-drain-dsn'],
        ['ksprod', '/kitchensink/global/sentry/log-drain-dsn'],
    ] as const)('%s can read %s', (qualifier, parameterPath) => {
        expect(readable(rendered(qualifier), parameterPath)).toBe(true);
    });
});

describe('the reads are tier-scoped', () => {
    it.each([
        ['ksnonprod', '/kitchensink/prod/domain/hosted-zone-id'],
        ['ksnonprod', '/kitchensink/identity/prod/webhooks/api/url'],
        ['ksnonprod', '/cdk-bootstrap/ksprod/version'],
        ['ksprod', '/kitchensink/sandbox/domain/hosted-zone-id'],
        ['ksprod', '/kitchensink/pr-91/domain/hosted-zone-id'],
        ['ksprod', '/cdk-bootstrap/ksnonprod/version'],
        ['ksaccount', '/cdk-bootstrap/ksprod/version'],
        ['ksaccount', '/kitchensink/prod/domain/hosted-zone-id'],
    ] as const)('%s cannot read %s', (qualifier, parameterPath) => {
        expect(readable(rendered(qualifier), parameterPath)).toBe(false);
    });

    it('fails when the bootstrap-version grant is dropped (the guard can see a missing read)', () => {
        const without = rendered('ksaccount').map((document) => ({
            ...document,
            Statement: document.Statement.filter((statement) => !statement.Sid.includes('Bootstrap')),
        }));

        expect(readable(without, '/cdk-bootstrap/ksaccount/version')).toBe(false);
    });
});
