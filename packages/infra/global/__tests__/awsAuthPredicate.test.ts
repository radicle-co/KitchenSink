// @vitest-environment node
/**
 * `.github/actions/awsAuth` decides, before it asks AWS for anything, whether this run can sign in at all — and the
 * three answers are not symmetric (ADR-0063).
 *
 * - **The run holds an OIDC request URL**: it continues, and the trust policy decides.
 * - **A fork's pull request or a Dependabot run**: GitHub withholds the token from these by design, so the action
 *   reports `authenticated=false` and the job skips what needs AWS. Nobody who can see that run can fix it, so a red
 *   would be unfixable.
 * - **Any other run with no URL**: the job (or a caller of its workflow) forgot `id-token: write`. That is RED. With
 *   the access key, the equivalent check read `secrets.AWS_ACCESS_KEY_ID`, and an absent grant became a permanent
 *   green skip — the shape this action exists to make impossible.
 *
 * The predicate runs as the action's own bash (`runWorkflowStep`), never a re-implementation, so a test cannot
 * agree with a copy that has drifted from what CI executes. The same step resolves the tier to a role name, and that
 * map is held equal to the stack's `GITHUB_ACTIONS_ROLE_NAMES`, so the two cannot name different roles.
 *
 * The identity check after sign-in compares the WHOLE assumed-role ARN: `kitchensink-gha-prod` is a prefix of
 * `kitchensink-gha-prod-read`, so any prefix or substring comparison would accept the wrong role.
 *
 * @pattern Specification — the availability rule is one bash step, judged here over a table of runs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { GITHUB_ACTIONS_ROLE_NAMES } from '../lib/platform/GithubActionsAccessStack.js';
import { GITHUB_OIDC_TIERS } from '../lib/platform/githubOidcTrust.js';
import { repoRoot } from '@kitchensink/repo-guards/serviceSources';
import { runWorkflowStep, type StepOutcome } from '@kitchensink/repo-guards/workflowStepRunner';
import { scalarText } from '@kitchensink/repo-guards/workflowScalar';

interface ActionStep {
    readonly id?: string;
    readonly name?: string;
    readonly if?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Action {
    readonly outputs?: Readonly<Record<string, { readonly value?: string }>>;
    readonly runs?: { readonly steps?: readonly ActionStep[] };
}

const ACTION = path.join(repoRoot, '.github', 'actions', 'awsAuth', 'action.yml');

const action = (): Action => parse(readFileSync(ACTION, 'utf8')) as Action;

const stepById = (id: string): ActionStep => {
    const step = action().runs?.steps?.find((candidate) => candidate.id === id);

    if (step === undefined) {
        throw new Error(`awsAuth has no step with id '${id}'`);
    }

    return step;
};

const REPOSITORY = 'radicle-co/KitchenSink';
const OIDC_URL = 'https://pipelines.actions.githubusercontent.com/oidc?api-version=2.0';

/** A same-repository pull request, with the token available. Each row overrides what it is about. */
const BASE_RUN: Readonly<Record<string, string>> = {
    TIER: 'nonprod',
    ACCOUNT_ID: '040663841500',
    SESSION_MINUTES: '60',
    EVENT_NAME: 'pull_request',
    REPOSITORY,
    HEAD_REPOSITORY: REPOSITORY,
    ACTOR: 'webb-c-brandon',
    ACTIONS_ID_TOKEN_REQUEST_URL: OIDC_URL,
};

const decide = (overrides: Readonly<Record<string, string>>): StepOutcome =>
    runWorkflowStep(scalarText(stepById('available').run), { ...BASE_RUN, ...overrides });

type Verdict = 'federate' | 'unauthenticated' | 'red';

const verdictOf = (outcome: StepOutcome): Verdict => {
    if (outcome.status !== 0) {
        return 'red';
    }

    if (outcome.outputs['federate'] === 'true' && outcome.outputs['authenticated'] === undefined) {
        return 'federate';
    }

    if (outcome.outputs['authenticated'] === 'false' && outcome.outputs['federate'] === undefined) {
        return 'unauthenticated';
    }

    throw new Error(`ambiguous outputs: ${JSON.stringify(outcome.outputs)}\n${outcome.log}`);
};

describe('awsAuth: may this run sign in at all?', () => {
    const NO_URL = { ACTIONS_ID_TOKEN_REQUEST_URL: '' };
    const rows: readonly {
        readonly run: string;
        readonly env: Readonly<Record<string, string>>;
        readonly verdict: Verdict;
    }[] = [
        { run: 'a same-repository pull request with the token', env: {}, verdict: 'federate' },
        { run: 'a push with the token', env: { EVENT_NAME: 'push', HEAD_REPOSITORY: '' }, verdict: 'federate' },
        {
            run: "a fork's pull request that somehow holds the token (the trust policy decides, not this step)",
            env: { HEAD_REPOSITORY: 'someone/KitchenSink' },
            verdict: 'federate',
        },
        { run: 'a same-repository pull request whose job forgot id-token: write', env: NO_URL, verdict: 'red' },
        {
            run: 'a push whose job forgot id-token: write',
            env: { ...NO_URL, EVENT_NAME: 'push', HEAD_REPOSITORY: '' },
            verdict: 'red',
        },
        {
            run: 'a manual dispatch whose job forgot id-token: write',
            env: { ...NO_URL, EVENT_NAME: 'workflow_dispatch', HEAD_REPOSITORY: '' },
            verdict: 'red',
        },
        {
            run: 'a push by a branch named like a fork is still a same-repository run',
            env: { ...NO_URL, EVENT_NAME: 'push', HEAD_REPOSITORY: 'someone/KitchenSink' },
            verdict: 'red',
        },
        {
            run: "a fork's pull request",
            env: { ...NO_URL, HEAD_REPOSITORY: 'someone/KitchenSink' },
            verdict: 'unauthenticated',
        },
        {
            run: 'a pull request whose fork was deleted (GitHub reports no head repository)',
            env: { ...NO_URL, HEAD_REPOSITORY: '' },
            verdict: 'unauthenticated',
        },
        { run: 'a Dependabot pull request', env: { ...NO_URL, ACTOR: 'dependabot[bot]' }, verdict: 'unauthenticated' },
        {
            run: 'a Dependabot push',
            env: { ...NO_URL, ACTOR: 'dependabot[bot]', EVENT_NAME: 'push', HEAD_REPOSITORY: '' },
            verdict: 'unauthenticated',
        },
        {
            run: 'an actor merely NAMED like Dependabot is not Dependabot',
            env: { ...NO_URL, ACTOR: 'dependabot' },
            verdict: 'red',
        },
    ];

    for (const row of rows) {
        it(`${row.run} → ${row.verdict}`, () => {
            const outcome = decide(row.env);

            expect(verdictOf(outcome), outcome.log).toBe(row.verdict);

            if (row.verdict === 'red') {
                expect(outcome.log).toMatch(/::error::/u);
            }
        });
    }
});

describe('awsAuth: which role, for how long', () => {
    for (const tier of GITHUB_OIDC_TIERS) {
        it(`tier '${tier}' names the stack's own role for it`, () => {
            const outcome = decide({ TIER: tier });

            expect(outcome.status, outcome.log).toBe(0);
            expect(outcome.outputs['role']).toBe(GITHUB_ACTIONS_ROLE_NAMES[tier]);
        });
    }

    it('names exactly the stack’s roles and no other', () => {
        const named = GITHUB_OIDC_TIERS.map((tier) => decide({ TIER: tier }).outputs['role']);

        expect(new Set(named)).toEqual(new Set(Object.values(GITHUB_ACTIONS_ROLE_NAMES)));
    });

    for (const tier of ['production', 'Prod', '', 'nonprod ', 'kitchensink-gha-prod']) {
        it(`refuses tier '${tier}', even on a fork that could not sign in anyway`, () => {
            expect(verdictOf(decide({ TIER: tier }))).toBe('red');
            expect(verdictOf(decide({ TIER: tier, ACTIONS_ID_TOKEN_REQUEST_URL: '', HEAD_REPOSITORY: 'x/y' }))).toBe(
                'red',
            );
        });
    }

    it('converts the session to seconds, defaulting to one hour', () => {
        expect(decide({}).outputs['session-seconds']).toBe('3600');
        expect(decide({ SESSION_MINUTES: '90' }).outputs['session-seconds']).toBe('5400');
        expect(decide({ SESSION_MINUTES: '180' }).outputs['session-seconds']).toBe('10800');
    });

    for (const minutes of ['14', '181', '0', '-5', 'sixty', '']) {
        it(`refuses a session of '${minutes}' minutes (STS takes 15 to the role's 180)`, () => {
            expect(verdictOf(decide({ SESSION_MINUTES: minutes }))).toBe('red');
        });
    }

    for (const account of ['', '04066384150', 'abcdefghijkl', '040663841500 ']) {
        it(`refuses account id '${account}' when it is about to sign in`, () => {
            expect(verdictOf(decide({ ACCOUNT_ID: account }))).toBe('red');
        });
    }
});

describe('awsAuth: is the session the role it asked for?', () => {
    const stubDir = mkdtempSync(path.join(tmpdir(), 'aws-stub-'));

    writeFileSync(path.join(stubDir, 'aws'), '#!/usr/bin/env bash\nprintf "%s\\n" "${STUB_CALLER_ARN}"\n', {
        mode: 0o755,
    });

    afterAll(() => {
        rmSync(stubDir, { recursive: true, force: true });
    });

    const expected = 'arn:aws:sts::040663841500:assumed-role/kitchensink-gha-prod/gha-123-1';

    const verify = (callerArn: string): StepOutcome =>
        runWorkflowStep(scalarText(stepById('verify').run), {
            PATH: `${stubDir}:${process.env['PATH'] ?? ''}`,
            EXPECTED_ARN: expected,
            STUB_CALLER_ARN: callerArn,
        });

    it('accepts exactly the expected session', () => {
        const outcome = verify(expected);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.outputs['authenticated']).toBe('true');
    });

    for (const [why, arn] of [
        [
            'the prod-read role, whose name has prod as a prefix',
            expected.replace('/kitchensink-gha-prod/', '/kitchensink-gha-prod-read/'),
        ],
        ['another session of the right role', expected.replace('gha-123-1', 'gha-999-1')],
        ['the right role in another account', expected.replace('040663841500', '123456789012')],
        ['the root user, which is what the access key signs in as', 'arn:aws:iam::040663841500:root'],
        ['nothing at all', ''],
    ] as const) {
        it(`refuses ${why}`, () => {
            const outcome = verify(arn);

            expect(outcome.status, outcome.log).not.toBe(0);
            expect(outcome.outputs['authenticated']).toBeUndefined();
        });
    }
});

describe('awsAuth: the steps around the predicate', () => {
    const steps = (): readonly ActionStep[] => action().runs?.steps ?? [];

    it('signs in only when the predicate says federate, with the role and session it resolved', () => {
        const signIn = steps().filter((step) => (step.uses ?? '').startsWith('aws-actions/configure-aws-credentials@'));

        expect(signIn).toHaveLength(1);
        expect(scalarText(signIn[0]?.if)).toBe("steps.available.outputs.federate == 'true'");
        expect(scalarText(signIn[0]?.with?.['role-to-assume'])).toBe(
            'arn:aws:iam::${{ inputs.account-id }}:role/${{ steps.available.outputs.role }}',
        );
        expect(scalarText(signIn[0]?.with?.['role-duration-seconds'])).toBe(
            '${{ steps.available.outputs.session-seconds }}',
        );
        expect(scalarText(signIn[0]?.with?.['role-session-name'])).toBe(
            'gha-${{ github.run_id }}-${{ github.run_attempt }}',
        );

        for (const key of ['aws-access-key-id', 'aws-secret-access-key', 'aws-session-token']) {
            expect(signIn[0]?.with?.[key], `awsAuth must never take ${key}`).toBeUndefined();
        }
    });

    it('verifies the same session name it asked for, right after signing in', () => {
        const all = steps();
        const signInIndex = all.findIndex((step) =>
            (step.uses ?? '').startsWith('aws-actions/configure-aws-credentials@'),
        );
        const verifyStep = all[signInIndex + 1] as ActionStep & { readonly env?: Readonly<Record<string, unknown>> };

        expect(verifyStep.id).toBe('verify');
        expect(scalarText(verifyStep.if)).toBe("steps.available.outputs.federate == 'true'");
        expect(scalarText(verifyStep.env?.['EXPECTED_ARN'])).toBe(
            'arn:aws:sts::${{ inputs.account-id }}:assumed-role/${{ steps.available.outputs.role }}/gha-${{ github.run_id }}-${{ github.run_attempt }}',
        );
    });

    it('reports authenticated from the verification, or the predicate’s false — never both empty', () => {
        expect(action().outputs?.['authenticated']?.value).toBe(
            '${{ steps.verify.outputs.authenticated || steps.available.outputs.authenticated }}',
        );
    });
});
