/**
 * The deployed-backstop policy check (`deployedE2eTiers.yml`, "The deployed backstop role may read queue attributes
 * and nothing else") exists to catch an OUT-OF-BAND policy attached to the QueueCheckRole. CI roles can read
 * AWS-managed policies only, so reading a customer-managed one is denied; inside a `$( { … } | jq )` that denial
 * was invisible (no `errexit` in a command substitution, and the group's status is its last command's) and the step
 * passed on exactly the case it exists for. These tests run the step's own bash against a fake `aws`.
 *
 * DESIGN PATTERN: Test double (a fake `aws` on PATH) over the workflow's own bash, via `runWorkflowStep`.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { runWorkflowStep } from './workflowStepRunner.js';

const STEP_NAME = 'The deployed backstop role may read queue attributes and nothing else';
const AWS_MANAGED = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
const CUSTOMER_MANAGED = 'arn:aws:iam::123456789012:policy/sneaky';

const stepBody = (): string => {
    const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/deployedE2eTiers.yml'), 'utf8')) as {
        jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
    };
    const hits = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).filter((s) => s.name === STEP_NAME));

    expect(hits).toHaveLength(1);

    return hits[0]?.run ?? '';
};

/** A fake `aws`. Attached policies come from `ATTACHED`; a policy ARN in `DENIED` answers AccessDenied. */
const FAKE_AWS = `#!/usr/bin/env bash
case "$1 $2" in
    "cloudformation describe-stack-resources") echo QueueCheckRole-abc ;;
    "iam list-role-policies") echo inlinePolicy ;;
    "iam list-attached-role-policies") echo "$ATTACHED" ;;
    "iam get-role-policy") echo '["sqs:GetQueueAttributes"]' ;;
    "iam get-policy")
        case " $DENIED " in *" $4 "*) echo AccessDenied >&2; exit 254 ;; esac
        echo v1 ;;
    "iam get-policy-version")
        case " $DENIED " in *" $4 "*) echo AccessDenied >&2; exit 254 ;; esac
        echo "\${GRANTED_ACTIONS:-[\\"logs:PutLogEvents\\"]}" ;;
esac
`;

const runStep = (env: { attached: readonly string[]; denied?: readonly string[]; granted?: string }) => {
    const bin = mkdtempSync(join(tmpdir(), 'backstopFakeAws-'));

    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'aws'), FAKE_AWS);
    chmodSync(join(bin, 'aws'), 0o755);

    return runWorkflowStep(stepBody(), {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        SIGNED_IN: 'true',
        TARGET_STAGE: 'sandbox',
        ATTACHED: env.attached.join(' '),
        DENIED: (env.denied ?? []).join(' '),
        ...(env.granted === undefined ? {} : { GRANTED_ACTIONS: env.granted }),
    });
};

describe('the backstop policy check', () => {
    it('passes for the CDK inline policy plus an AWS-managed one that grants no sqs action', () => {
        expect(runStep({ attached: [AWS_MANAGED] }).status).toBe(0);
    });

    it('is red when an AWS-managed policy grants a second sqs action', () => {
        const r = runStep({ attached: [AWS_MANAGED], granted: '["sqs:SendMessage"]' });

        expect(r.status).not.toBe(0);
        expect(r.log).toContain('sqs:SendMessage');
    });

    it('is red for a customer-managed policy attached out of band, even when it is not the last one listed', () => {
        const r = runStep({ attached: [CUSTOMER_MANAGED, AWS_MANAGED], denied: [CUSTOMER_MANAGED] });

        expect(r.status).not.toBe(0);
        expect(r.log).toContain('attached out of band');
    });

    it('is red when reading an AWS-managed policy fails (an access failure is not a pass)', () => {
        const r = runStep({ attached: [AWS_MANAGED], denied: [AWS_MANAGED] });

        expect(r.status).not.toBe(0);
        expect(r.log).toContain('could not read every policy');
    });
});
