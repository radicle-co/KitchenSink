/**
 * CI roles security review, MEDIUM-1: the repositories production pulls from (`kitchensink-identity`, `-food`,
 * `-recipes`) are also pushed to by every preview, through a role that any branch's workflow can assume. With MUTABLE
 * tags such a job could re-point a tag production runs.
 *
 * How production pulls: by TAG, and the tag is the commit (`<sha>` from `prod-deploy.yml`, `prod-<sha>` from
 * `deployInfra.yml`); previews write `sandbox-<sha>` and `pr-<n>-<sha>`. So the tags a preview legitimately writes are
 * exactly the two lifecycle-policy prefixes, and everything else is a release. The repositories are therefore
 * `IMMUTABLE_WITH_EXCLUSION`, excluding (= leaving mutable) the preview prefixes and nothing else.
 *
 * ⛔ A rerun of the same commit must still work. A release push to an immutable tag fails when the tag exists, and a
 * rebuild never reproduces the digest, so the workflows ask `ecrPushVerdict.sh` first and skip the build when the
 * release tag is already there (the same commit is the same image). Previews are always rebuilt: their tags stay
 * mutable. These tests run both scripts against a fake `aws` and judge what it was asked.
 *
 * DESIGN PATTERN: Test double (a recording fake `aws` on PATH) over a Specification (the verdict) and a Policy (the
 * mutability setting), each fired at the shapes that distinguish it from its mutations.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPTS = path.join(repoRoot, '.github/scripts');
const ENSURE = path.join(SCRIPTS, 'ecrEnsureRepo.sh');
const VERDICT = path.join(SCRIPTS, 'ecrPushVerdict.sh');
const RECORD = path.join(SCRIPTS, 'ecrRecordRelease.sh');
const POLICY = JSON.parse(readFileSync(path.join(SCRIPTS, 'ecrLifecyclePolicy.json'), 'utf8')) as {
    rules: { selection: { tagPrefixList?: string[] } }[];
};

const SHA = '67f56925ef02406f9e6b4530c868e914cb555daa';
/** The one mutable tag that is not a preview image: the BuildKit layer cache `infra-image` writes (exact, no wildcard). */
const CACHE_TAG = 'buildcache';
/** The content-tag prefix (`ecrTagKind.sh`): retained by the policy, but IMMUTABLE, so never a mutable filter. */
const CONTENT_PREFIX = 'ck-';
const CONTENT_TAG = `${CONTENT_PREFIX}${'ab'.repeat(32)}`;
const MUTABLE_FILTERS = [...new Set(POLICY.rules.flatMap((rule) => rule.selection.tagPrefixList ?? [])).values()]
    .filter((prefix) => prefix !== CONTENT_PREFIX)
    .map((prefix) => `${prefix}*`)
    .concat(CACHE_TAG)
    .sort();

/** What the fake `aws` answers. Everything else it is asked is recorded and succeeds. */
interface Scenario {
    /** `describe-repositories`: absent (exit 254) or the repository as ECR returns it. */
    readonly repository?: { readonly mutability: string; readonly filters: readonly string[] } | 'absent';
    /** `describe-images`: present, absent (ImageNotFoundException) or a failure that says nothing about the image. */
    readonly image?: 'present' | 'absent' | 'denied';
    /** `put-image-tag-mutability` is refused (the non-prod role does not hold it). */
    readonly putMutabilityDenied?: boolean;
    /**
     * The production-only release ledger (`/kitchensink/prod/releaseImages/<repo>/<tag>` = the digest production
     * pushed). `matches` holds the digest `describe-images` returns, `other` a different one.
     */
    readonly ledger?: 'absent' | 'matches' | 'other' | 'denied';
    /** `put-parameter` into the ledger: accepted, refused because the name exists, or refused outright. */
    readonly ledgerWrite?: 'ok' | 'exists' | 'denied';
}

interface Run {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    /** One line per `aws` call, its arguments as given. */
    readonly calls: readonly string[];
}

const FAKE_AWS = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_AWS_LOG"
case "$1 $2" in
    "ecr describe-repositories")
        if [ -z "\${FAKE_REPOSITORY:-}" ]; then echo 'RepositoryNotFoundException' >&2; exit 254; fi
        echo "$FAKE_REPOSITORY"
        ;;
    "ecr describe-images")
        case "\${FAKE_IMAGE:-absent}" in
            present) echo '{"imageDetails":[{"imageDigest":"sha256:abc"}]}' ;;
            absent) echo 'An error occurred (ImageNotFoundException) when calling the DescribeImages operation' >&2; exit 254 ;;
            *) echo 'An error occurred (AccessDeniedException) when calling the DescribeImages operation' >&2; exit 254 ;;
        esac
        ;;
    "ssm get-parameter")
        case "\${FAKE_LEDGER:-absent}" in
            matches) echo 'sha256:abc' ;;
            other) echo 'sha256:planted' ;;
            absent) echo 'An error occurred (ParameterNotFound) when calling the GetParameter operation' >&2; exit 254 ;;
            *) echo 'An error occurred (AccessDeniedException) when calling the GetParameter operation' >&2; exit 254 ;;
        esac
        ;;
    "ssm put-parameter")
        case "\${FAKE_LEDGER_WRITE:-ok}" in
            ok) ;;
            exists) echo 'An error occurred (ParameterAlreadyExists) when calling the PutParameter operation' >&2; exit 254 ;;
            *) echo 'An error occurred (AccessDeniedException) when calling the PutParameter operation' >&2; exit 254 ;;
        esac
        ;;
    "ecr put-image-tag-mutability")
        if [ "\${FAKE_PUT_MUTABILITY_DENIED:-}" = 1 ]; then echo 'AccessDeniedException' >&2; exit 254; fi
        ;;
esac
exit 0
`;

const run = (script: string, args: readonly string[], scenario: Scenario): Run => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ecrEnsureRepo-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'calls.log');

    mkdirSync(bin);
    writeFileSync(path.join(bin, 'aws'), FAKE_AWS);
    chmodSync(path.join(bin, 'aws'), 0o755);
    writeFileSync(log, '');

    const repository = scenario.repository ?? 'absent';
    const result = spawnSync('bash', [script, ...args], {
        encoding: 'utf8',
        env: {
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            FAKE_AWS_LOG: log,
            FAKE_REPOSITORY:
                repository === 'absent'
                    ? ''
                    : JSON.stringify({
                          repositories: [
                              {
                                  repositoryName: 'kitchensink-food',
                                  imageTagMutability: repository.mutability,
                                  imageTagMutabilityExclusionFilters: repository.filters.map((filter) => ({
                                      filterType: 'WILDCARD',
                                      filter,
                                  })),
                              },
                          ],
                      }),
            FAKE_IMAGE: scenario.image ?? 'absent',
            FAKE_LEDGER: scenario.ledger ?? 'absent',
            FAKE_LEDGER_WRITE: scenario.ledgerWrite ?? 'ok',
            FAKE_PUT_MUTABILITY_DENIED: scenario.putMutabilityDenied === true ? '1' : '',
        },
    });

    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    };
};

const callsTo = (r: Run, verb: string): readonly string[] => r.calls.filter((call) => call.startsWith(`ecr ${verb} `));

const CONFIGURED = { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: MUTABLE_FILTERS } as const;

describe('ecrEnsureRepo.sh: release tags are immutable, preview tags are not', () => {
    it('the mutable filters are the lifecycle policy preview prefixes, each as a wildcard, plus the exact cache tag', () => {
        expect(MUTABLE_FILTERS).toEqual(['buildcache', 'pr-*', 'sandbox-*']);
    });

    // ⛔ The cache tag is mutable (BuildKit rewrites it every build) but it is NOT a preview: it must never reach the
    // push verdict's skip path or the release ledger, and a release shape must still be refused a mutable tag.
    it('treats the cache tag as mutable without making it a preview or a release', () => {
        const create =
            callsTo(run(ENSURE, ['kitchensink-food'], { repository: 'absent' }), 'create-repository')[0] ?? '';

        expect(create).toContain('filterType=WILDCARD,filter=buildcache ');
        expect(create).not.toContain('filter=buildcache*');
        expect(create).not.toContain('filter=prod-');
        expect(run(VERDICT, ['kitchensink-food', CACHE_TAG], { image: 'present', ledger: 'absent' }).status).toBe(1);
    });

    it('creates a missing repository already immutable, excluding exactly the preview prefixes', () => {
        const r = run(ENSURE, ['kitchensink-food'], { repository: 'absent' });
        const create = callsTo(r, 'create-repository');

        expect(r.status).toBe(0);
        expect(create).toHaveLength(1);
        expect(create[0]).toContain('--image-tag-mutability IMMUTABLE_WITH_EXCLUSION');

        for (const filter of MUTABLE_FILTERS) {
            expect(create[0]).toContain(`filterType=WILDCARD,filter=${filter}`);
        }

        expect(create[0]?.match(/filterType=/gu)).toHaveLength(MUTABLE_FILTERS.length);
        expect(callsTo(r, 'put-lifecycle-policy')).toHaveLength(1);
    });

    it.each([
        ['mutable', { mutability: 'MUTABLE', filters: [] }],
        ['immutable with no exclusion', { mutability: 'IMMUTABLE', filters: [] }],
        ['immutable but excluding a release shape', { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: ['*'] }],
        ['missing one preview prefix', { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: ['sandbox-*'] }],
        ['an extra exclusion', { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: [...MUTABLE_FILTERS, 'prod-*'] }],
    ])('re-points an existing repository that is %s', (_label, repository) => {
        const r = run(ENSURE, ['kitchensink-food'], { repository });
        const put = callsTo(r, 'put-image-tag-mutability');

        expect(r.status).toBe(0);
        expect(put).toHaveLength(1);
        expect(put[0]).toContain('--image-tag-mutability IMMUTABLE_WITH_EXCLUSION');
        expect(put[0]?.match(/filterType=/gu)).toHaveLength(MUTABLE_FILTERS.length);
        expect(callsTo(r, 'create-repository')).toEqual([]);
    });

    it('makes no mutability call when the repository is already as wanted, whatever order ECR lists the filters', () => {
        const r = run(ENSURE, ['kitchensink-food'], {
            repository: { ...CONFIGURED, filters: [...MUTABLE_FILTERS].reverse() },
        });

        expect(callsTo(r, 'put-image-tag-mutability')).toEqual([]);
        expect(callsTo(r, 'create-repository')).toEqual([]);
        expect(callsTo(r, 'put-lifecycle-policy')).toHaveLength(1);
    });

    // The non-prod role cannot change a repository's mutability (that is the point: it could otherwise turn the
    // protection off), so on a repository that is not yet immutable its preview run must warn and carry on.
    it('warns and continues when the mutability change is refused, still applying retention', () => {
        const r = run(ENSURE, ['kitchensink-food'], {
            repository: { mutability: 'MUTABLE', filters: [] },
            putMutabilityDenied: true,
        });

        expect(r.status).toBe(0);
        expect(r.stderr + r.stdout).toContain('::warning::');
        expect(callsTo(r, 'put-lifecycle-policy')).toHaveLength(1);
    });
});

/**
 * Content tags (`ck-<key>`) are IMMUTABLE. The retention policy keeps them under a rule of its own, and every
 * retention prefix used to become a mutable filter: so the content prefix is subtracted, or the next production
 * deploy (the only role that may change mutability) would silently make content tags overwritable.
 */
describe('ecrEnsureRepo.sh: content tags stay immutable', () => {
    /** ECR's WILDCARD filter semantics: `*` matches any run of characters. */
    const matches = (filter: string, tag: string): boolean =>
        new RegExp(`^${filter.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*')}$`, 'u').test(tag);

    const createdFilters = (): readonly string[] => {
        const create =
            callsTo(run(ENSURE, ['kitchensink-food'], { repository: 'absent' }), 'create-repository')[0] ?? '';

        return [...create.matchAll(/filterType=WILDCARD,filter=(\S+)/gu)].map((m) => m[1] ?? '').sort();
    };

    it('creates a repository whose mutable filters are exactly the preview prefixes and the cache tag', () => {
        expect(createdFilters()).toEqual(['buildcache', 'pr-*', 'sandbox-*']);
    });

    it('matches no content tag with any mutable filter', () => {
        expect(createdFilters().filter((filter) => matches(filter, CONTENT_TAG))).toEqual([]);
    });

    it('is not vacuous: the matcher does match a preview tag', () => {
        expect(createdFilters().some((filter) => matches(filter, `sandbox-${SHA}`))).toBe(true);
    });
});

describe('ecrPushVerdict.sh: a content tag already in the repository is not built again', () => {
    const verdict = (scenario: Scenario): Run => run(VERDICT, ['kitchensink-food', CONTENT_TAG], scenario);

    // The tag IS the content: an image under it was built from these inputs, and the tag cannot be overwritten.
    it('skips when the content tag exists in a repository that keeps it immutable, asking no ledger', () => {
        const r = verdict({ image: 'present', repository: CONFIGURED });

        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('skip');
        expect(r.calls.filter((call) => call.startsWith('ssm '))).toEqual([]);
    });

    it('skips when the repository makes every tag immutable', () => {
        const r = verdict({ image: 'present', repository: { mutability: 'IMMUTABLE', filters: [] } });

        expect(r.stdout.trim()).toBe('skip');
    });

    // ⛔ An image under a content tag is only the content while nothing can overwrite the tag. Where something can, any
    // branch may have replaced it, so the tag is rebuilt and never trusted (slice 1 review, blocker 1).
    it.each([
        ['the repository is mutable', { mutability: 'MUTABLE', filters: [] }],
        ['an exclusion filter names the content prefix', { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: ['ck-*'] }],
        ['an exclusion filter matches every tag', { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: ['*'] }],
        [
            'an exclusion filter matches this tag inside it',
            { mutability: 'IMMUTABLE_WITH_EXCLUSION', filters: ['*abab*'] },
        ],
    ])('pushes, never trusting the tag, when %s', (_label, repository) => {
        const r = verdict({ image: 'present', repository });

        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('push');
        expect(r.stderr).toContain('can be overwritten');
    });

    it('fails, answering nothing, when the repository cannot be described', () => {
        const r = verdict({ image: 'present', repository: 'absent' });

        expect(r.status).toBe(1);
        expect(r.stdout.trim()).toBe('');
        expect(r.stderr).toContain('::error::');
    });

    it('pushes when the content tag is absent', () => {
        const r = verdict({ image: 'absent' });

        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('push');
    });

    it('fails, answering nothing, when ECR cannot say whether the content tag exists', () => {
        const r = verdict({ image: 'denied' });

        expect(r.status).not.toBe(0);
        expect(r.stdout.trim()).toBe('');
        expect(r.stderr).toContain('::error::');
    });
});

describe('ecrPushVerdict.sh: a release tag already in the repository is not pushed again', () => {
    const verdict = (tag: string, scenario: Scenario): Run => run(VERDICT, ['kitchensink-food', tag], scenario);

    const rows: readonly (readonly [string, string, NonNullable<Scenario['image']>, string])[] = [
        ['bare sha, already pushed (a rerun)', SHA, 'present', 'skip'],
        ['bare sha, first push', SHA, 'absent', 'push'],
        ['prod-prefixed sha, already pushed (a rerun)', `prod-${SHA}`, 'present', 'skip'],
        ['prod-prefixed sha, first push', `prod-${SHA}`, 'absent', 'push'],
        // Preview tags are mutable and always rebuilt, so a rerun refreshes them whether or not they exist.
        ['sandbox preview, already pushed', `sandbox-${SHA}`, 'present', 'push'],
        ['pr preview, already pushed', `pr-91-${SHA}`, 'present', 'push'],
        ['pr preview, first push', `pr-91-${SHA}`, 'absent', 'push'],
    ];

    it.each(rows)('%s -> %s', (_label, tag, image, expected) => {
        const r = verdict(tag, { image, ledger: 'matches' });

        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe(expected);
    });

    it('never asks ECR about a preview tag', () => {
        expect(verdict(`pr-91-${SHA}`, { image: 'present' }).calls).toEqual([]);
    });

    // A failure that says nothing about the image is not "absent": answering `push` would fail on an immutable tag
    // that does exist, and `skip` would ship an image nobody pushed.
    it('fails, answering nothing, when ECR cannot say whether the tag exists', () => {
        const r = verdict(SHA, { image: 'denied' });

        expect(r.status).not.toBe(0);
        expect(r.stdout.trim()).toBe('');
        expect(r.stderr).toContain('::error::');
    });

    it('refuses a missing argument', () => {
        const r = run(VERDICT, ['kitchensink-food'], {});

        expect(r.status).toBe(2);
    });
});

/**
 * CI roles security review, HIGH-1: a skip trusts the tag, and the non-prod role (any branch) can push a NEW release-shaped
 * tag into the repository production pulls from, so "the tag exists" is not "production built it". ECR has no IAM
 * condition on the image tag, so the proof is a LEDGER only the production role can write: the digest it pushed.
 * A skip needs the existing image to be the recorded one; anything else fails closed and never deploys.
 */
describe('ecrPushVerdict.sh: production never trusts a release tag it did not build', () => {
    const verdict = (scenario: Scenario): Run => run(VERDICT, ['kitchensink-food', SHA], scenario);

    it('skips only when the image under the tag is the digest the ledger recorded', () => {
        const r = verdict({ image: 'present', ledger: 'matches' });

        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('skip');
        expect(r.calls.some((call) => call.includes(`/kitchensink/prod/releaseImages/kitchensink-food/${SHA}`))).toBe(
            true,
        );
    });

    it.each([
        ['no ledger entry (planted, or never recorded)', 'absent'],
        ['a ledger digest that is not the image digest (replaced)', 'other'],
        ['a ledger that cannot be read', 'denied'],
    ] as const)('refuses, answering nothing, with %s', (_label, ledger) => {
        const r = verdict({ image: 'present', ledger });

        expect(r.status).not.toBe(0);
        expect(r.stdout.trim()).toBe('');
        expect(r.stderr).toContain('::error::');
    });

    it('does not consult the ledger when the tag is absent (a first push) or a preview', () => {
        expect(verdict({ image: 'absent' }).calls.filter((call) => call.startsWith('ssm '))).toEqual([]);
        expect(run(VERDICT, ['kitchensink-food', `pr-91-${SHA}`], { image: 'present' }).calls).toEqual([]);
    });
});

describe('ecrRecordRelease.sh: production records the digest it pushed', () => {
    const record = (scenario: Scenario, tag = SHA): Run => run(RECORD, ['kitchensink-food', tag], scenario);
    const writes = (r: Run): readonly string[] => r.calls.filter((call) => call.startsWith('ssm put-parameter'));

    it('writes the pushed digest under the ledger name, never overwriting', () => {
        const r = record({ image: 'present' });

        expect(r.status).toBe(0);
        expect(writes(r)).toHaveLength(1);
        expect(writes(r)[0]).toContain(`--name /kitchensink/prod/releaseImages/kitchensink-food/${SHA}`);
        expect(writes(r)[0]).toContain('--value sha256:abc');
        expect(writes(r)[0]).toContain('--no-overwrite');
    });

    it('accepts an entry that already holds the same digest (a rerun)', () => {
        expect(record({ image: 'present', ledgerWrite: 'exists', ledger: 'matches' }).status).toBe(0);
    });

    it('fails when the existing entry holds a different digest', () => {
        const r = record({ image: 'present', ledgerWrite: 'exists', ledger: 'other' });

        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('::error::');
    });

    it('fails when the ledger cannot be written', () => {
        expect(record({ image: 'present', ledgerWrite: 'denied' }).status).not.toBe(0);
    });

    it('fails when the image it should record is not there', () => {
        expect(record({ image: 'absent' }).status).not.toBe(0);
    });

    it('does nothing for a content tag: it is not a release', () => {
        const r = record({ image: 'present' }, CONTENT_TAG);

        expect(r.status).toBe(0);
        expect(r.calls).toEqual([]);
    });

    it('does nothing for a preview tag', () => {
        const r = record({ image: 'present' }, `sandbox-${SHA}`);

        expect(r.status).toBe(0);
        expect(r.calls).toEqual([]);
    });
});

describe('every caller of ecrPushVerdict.sh also records what it pushes', () => {
    // A skip trusts the ledger, so a push that never writes it turns the next rerun of that commit into a hard stop.
    const callers = ['.github/workflows/prod-deploy.yml', '.github/actions/infra-image/action.yml'];

    it.each(callers)('%s records once per verdict it asks for', (file) => {
        const text = readFileSync(path.join(repoRoot, file), 'utf8');
        const asks = (text.match(/bash \.github\/scripts\/ecrPushVerdict\.sh/g) ?? []).length;
        const records = (text.match(/bash \.github\/scripts\/ecrRecordRelease\.sh/g) ?? []).length;

        expect(asks).toBeGreaterThan(0);
        expect(records).toBe(asks);
    });
});
