// @vitest-environment node
/**
 * Unit tests for `scripts/deploymentDrift.mjs` — the half that compares a DECLARATION against REALITY.
 *
 * ## The failure, stated exactly
 *
 * `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 said `verifyLine` and thirteen other
 * handlers were deployed. `kitchensink-recipe-workers-prod` held SIX Lambdas
 * (AccountErasureWorker, ArchiveSweeper, ErasureOrphanSweeper, ErasureSweeper, HandleSyncWorker,
 * VersionArchiveWorker), last updated 2026-08-02, with the branch 600+ commits ahead. Neither `verifyLine`
 * nor `parseLine` existed in any account.
 *
 * ⛔ `infrastructureManifest.mjs` alone would NOT have caught that: both handlers ARE declared at HEAD, so a
 * generated document says exactly what the prose table said. Only the account settles it. This module is
 * therefore the point of the whole change, and everything it reports has to be a fact about the ACCOUNT.
 *
 * ## Why the Lambda comparison is on HANDLERS and not on logical ids
 *
 * Measured, not assumed. Synthesizing `new lambda.Function(stack, 'VersionArchiveWorkerFunction', …)` emits
 * the logical id `VersionArchiveWorkerFunction1E510C35` — CDK appends an 8-character hash derived from the
 * construct PATH, so a construct that merely MOVES in the tree changes its logical id while running the same
 * code. Comparing those would report one spurious "missing" and one spurious "unexpected" for a refactor
 * that deployed correctly, and a check that cries wolf is a check that gets deleted. A handler string
 * (`handlers/verifyLine.handler`) is what the manifest declares, what `lambda:GetFunctionConfiguration`
 * returns, and what actually answers the question "is this code running?".
 *
 * ## The four verdicts, and why `untagged` is not `unknown`
 *
 * They are different facts and they need different actions. `untagged` means the stack predates the
 * provenance stamp — expected exactly once per stack, and it clears itself on the next deploy. `unknown`
 * means something deployed it that could not name its own commit, which is a pipeline defect. Collapsing
 * them would make the first deploy after this change look like a defect, and the report would be ignored
 * from then on.
 *
 * ## Mutation evidence
 *
 * Making `classifyCommitTag` return `current` for a mismatched sha reds 'reports a stale deploy'. Dropping
 * the abbreviation comparison reds 'treats an abbreviated sha as the same commit'. Removing the `conditional`
 * bucket from `diffHandlers` reds 'does not accuse a prod-only handler of being missing from sandbox'.
 * Removing the absent-stack branch reds 'reports an absent stack as the loudest finding'.
 *
 * ## Two cases here came from a REAL run, not from imagination
 *
 * The first live invocation against prod produced two false positives and one true finding, and all three
 * are pinned below. `kitchensink-sandbox-scheduler-prod` was reported NOT DEPLOYED (it is sandbox-only,
 * ADR-0007) and `kitchensink-data-prod` was reported as running four undeclared handlers (all four are
 * CDK's own custom-resource framework functions). Both are now REPORTED and neither is a finding. The true
 * one — `kitchensink-service-logs-prod` genuinely absent, ADR-0028 having added it after prod's last
 * platform deploy — is exactly what this module exists to say out loud.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import {
    COMMIT_TAG_KEY,
    classifyCommitTag,
    declaredForStage,
    diffHandlers,
    formatDriftReport,
    hasDriftFindings,
    toSourceEntrypoint,
} from '../../../../scripts/deploymentDrift.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('the two halves agree on the tag key', () => {
    it('reads the key the stamp writes', () => {
        // ⛔ One knowledge, two modules — the WRITER (`@kitchensink/infra-security`) and the READER (this
        // script). A rename on either side would make every deployed stack read as untagged, silently
        // resetting the baseline instead of failing.
        //
        // Asserted by reading the writer's SOURCE rather than importing it, for two reasons that are both
        // properties of the thing being guarded: `@kitchensink/infra-security` exports BUILT JavaScript (see
        // its manifest's `//exports` note), so an import would assert against whatever was last compiled;
        // and `deploymentDrift.mjs` deliberately re-declares the constant instead of importing it, because
        // it runs under plain `node` from a checkout that may not have been built. Reading the literal is
        // what makes that deliberate duplication safe.
        const stamp = readFileSync(path.join(repoRoot, 'packages/infra/security/src/commitProvenance.ts'), 'utf8');
        const declared = /export const COMMIT_TAG_KEY = '(?<key>[^']+)'/u.exec(stamp)?.groups?.['key'];

        expect(declared, 'commitProvenance.ts no longer declares COMMIT_TAG_KEY as a plain literal').toBeDefined();
        expect(COMMIT_TAG_KEY).toBe(declared);
    });
});

describe('classifyCommitTag', () => {
    it('reports a matching sha as current', () => {
        expect(classifyCommitTag(SHA, SHA).verdict).toBe('current');
    });

    it('treats an abbreviated sha as the same commit', () => {
        // A manual deploy may stamp `git rev-parse --short HEAD`. Reporting that as stale would be a false
        // alarm on a correct deploy.
        expect(classifyCommitTag(SHA, SHA.slice(0, 7)).verdict).toBe('current');
        expect(classifyCommitTag(SHA.slice(0, 7), SHA).verdict).toBe('current');
    });

    it('reports a stale deploy, and says which commit is running', () => {
        const { verdict, reason } = classifyCommitTag(SHA, OTHER);

        expect(verdict).toBe('stale');
        expect(reason).toContain(OTHER);
        expect(reason).toContain(SHA);
    });

    it('refuses to call a 7-character prefix collision a match by accident', () => {
        // `abcdefg…` vs `abcdefh…`: prefix comparison must be anchored at the start AND require the shorter
        // to be a genuine prefix, not merely overlapping.
        expect(classifyCommitTag(`${'a'.repeat(6)}b${'a'.repeat(33)}`, `${'a'.repeat(6)}c`).verdict).toBe('stale');
    });

    it('reports an absent tag as `untagged`, never as ok', () => {
        // ⛔ The permissive direction is what re-creates the defect: a stack with no provenance is a stack
        // whose age is unknowable, which is the exact state prod was in.
        expect(classifyCommitTag(SHA, undefined).verdict).toBe('untagged');
        expect(classifyCommitTag(SHA, '').verdict).toBe('untagged');
    });

    it('distinguishes `unknown` from `untagged`', () => {
        expect(classifyCommitTag(SHA, 'unknown').verdict).toBe('unknown');
    });

    it('reports an unusable EXPECTED sha as indeterminate rather than as drift', () => {
        // Comparing against a value that is not a commit would red every run for a reason the author cannot
        // act on. Say what is wrong instead.
        expect(classifyCommitTag('unknown', SHA).verdict).toBe('indeterminate');
        expect(classifyCommitTag('', SHA).verdict).toBe('indeterminate');
    });
});

describe('diffHandlers', () => {
    const declared = [
        {
            logicalId: 'VersionArchiveWorkerFunction',
            handler: 'handlers/versionArchiveWorker.handler',
            condition: null,
        },
        { logicalId: 'IngredientVerificationFunction', handler: 'handlers/verifyLine.handler', condition: null },
        { logicalId: 'RecipeParseLineFunction', handler: 'handlers/parseLine.handler', condition: null },
    ];

    it('names the declared handlers that are not running — the sentence this exists to produce', () => {
        const { missing } = diffHandlers({ declared, deployed: ['handlers/versionArchiveWorker.handler'] });

        expect(missing).toEqual([
            { logicalId: 'IngredientVerificationFunction', handler: 'handlers/verifyLine.handler' },
            { logicalId: 'RecipeParseLineFunction', handler: 'handlers/parseLine.handler' },
        ]);
    });

    it('reports nothing when every declared handler is running', () => {
        const deployed = declared.map((entry) => entry.handler);

        expect(diffHandlers({ declared, deployed })).toMatchObject({ missing: [], unexpected: [] });
    });

    it('reports a deployed handler nobody declares — code running that the source has dropped', () => {
        const { unexpected } = diffHandlers({
            declared,
            deployed: [...declared.map((entry) => entry.handler), 'handlers/deletedWorker.handler'],
        });

        expect(unexpected).toEqual(['handlers/deletedWorker.handler']);
    });

    it('does not accuse a prod-only handler of being missing from another stage', () => {
        // ADR-0008's guardrails and ADR-0020's edge stack are prod-only, and a conditional handler absent
        // from sandbox is correct. Reported for visibility, never as a finding.
        const conditional = [
            { logicalId: 'ProdOnly', handler: 'handlers/prodOnly.handler', condition: "stage === 'prod'" },
        ];
        const result = diffHandlers({ declared: conditional, deployed: [] });

        expect(result.missing).toEqual([]);
        expect(result.conditional).toEqual([
            { logicalId: 'ProdOnly', handler: 'handlers/prodOnly.handler', condition: "stage === 'prod'" },
        ]);
    });

    it('reports a handler the manifest could not read as unreadable, never as missing', () => {
        // `RecipeSchemaMigrationRunner`'s handler is a ternary. Calling it missing would be an accusation
        // this comparison has no evidence for.
        const unreadable = [{ logicalId: 'RecipeSchemaMigrationRunner', handler: null, condition: null }];
        const result = diffHandlers({ declared: unreadable, deployed: [] });

        expect(result.missing).toEqual([]);
        expect(result.unreadable).toEqual(['RecipeSchemaMigrationRunner']);
    });
});

const MANIFEST = {
    schemaVersion: 1,
    claim: 'declares, not deploys',
    generator: 'scripts/infrastructureManifest.mjs',
    apps: [
        {
            entrypoint: 'packages/services/recipe-workers/infra/bin/app.ts',
            packageName: '@kitchensink/recipe-workers',
            stacks: [
                {
                    className: 'RecipeWorkersStack',
                    source: 'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts',
                    stackNameTemplate: 'kitchensink-recipe-workers-{stage}',
                    condition: null,
                    resources: [
                        {
                            kind: 'lambdaFunction',
                            logicalId: 'IngredientVerificationFunction',
                            handler: 'handlers/verifyLine.handler',
                            nameTemplate: null,
                            condition: null,
                            notes: [],
                        },
                        {
                            kind: 'queue',
                            logicalId: 'RecipeParseQueue',
                            handler: null,
                            nameTemplate: 'kitchensink-recipe-parse-{stage}',
                            condition: null,
                            notes: [],
                        },
                    ],
                    unclassifiedConstructs: [],
                    unfollowedConstructs: [],
                },
            ],
        },
    ],
};

describe('toSourceEntrypoint', () => {
    it('drops the runner', () => {
        expect(toSourceEntrypoint('npx tsx packages/services/recipe-workers/infra/bin/app.ts')).toBe(
            'packages/services/recipe-workers/infra/bin/app.ts',
        );
    });

    it('maps a COMPILED entrypoint back to its source', () => {
        // ⛔ `prod-deploy.yml` deploys the compiled path. Without this, every prod drift check throws "no
        // entry for" — a loud failure, but for entirely the wrong reason, and the fix people would reach for
        // is deleting the step.
        expect(toSourceEntrypoint('node packages/infra/global/dist/bin/app.js')).toBe(
            'packages/infra/global/bin/app.ts',
        );
    });

    it('leaves a path that merely CONTAINS dist alone', () => {
        expect(toSourceEntrypoint('npx tsx packages/dist-tools/infra/bin/app.ts')).toBe(
            'packages/dist-tools/infra/bin/app.ts',
        );
    });
});

describe('declaredForStage', () => {
    it('resolves the stack name for the stage asked about', () => {
        const [stack] = declaredForStage(MANIFEST, 'packages/services/recipe-workers/infra/bin/app.ts', 'prod');

        expect(stack.stackName).toBe('kitchensink-recipe-workers-prod');
    });

    it('carries only the Lambda handlers into the comparison', () => {
        // A queue has no handler; including it would compare a name against a handler and always find drift.
        const [stack] = declaredForStage(MANIFEST, 'packages/services/recipe-workers/infra/bin/app.ts', 'prod');

        expect(stack.handlers).toEqual([
            { logicalId: 'IngredientVerificationFunction', handler: 'handlers/verifyLine.handler', condition: null },
        ]);
    });

    it('throws for an entrypoint the manifest does not carry, rather than verifying nothing', () => {
        // Vacuity guard. Silently returning [] would report a clean drift check for an app nobody read.
        expect(() => declaredForStage(MANIFEST, 'packages/services/nope/infra/bin/app.ts', 'prod')).toThrow(
            /no entry for/u,
        );
    });
});

/** The recipe-workers reality of 2026-08-28, as this module would have described it. */
const REAL_FINDING = {
    stage: 'prod',
    expected: SHA,
    stacks: [
        {
            stackName: 'kitchensink-recipe-workers-prod',
            condition: null,
            present: true,
            commit: { verdict: 'stale' as const, reason: `deployed at ${OTHER}, expected ${SHA}`, deployed: OTHER },
            handlers: {
                missing: [
                    { logicalId: 'IngredientVerificationFunction', handler: 'handlers/verifyLine.handler' },
                    { logicalId: 'RecipeParseLineFunction', handler: 'handlers/parseLine.handler' },
                ],
                unexpected: [],
                conditional: [],
                unreadable: [],
            },
        },
    ],
};

describe('hasDriftFindings', () => {
    it('is true for the 2026-08-28 prod reality', () => {
        expect(hasDriftFindings(REAL_FINDING.stacks)).toBe(true);
    });

    it('is true for an absent UNCONDITIONAL stack', () => {
        // The first real run of this module found one: `kitchensink-service-logs-prod`, which ADR-0028
        // added and which prod has never had.
        expect(
            hasDriftFindings([
                { stackName: 'kitchensink-x-prod', condition: null, present: false, commit: null, handlers: null },
            ]),
        ).toBe(true);
    });

    it('is FALSE for an absent stack that is declared behind a guard', () => {
        // ⛔ Measured false positive from that same run: `kitchensink-sandbox-scheduler-prod` exists only for
        // `sandbox` (ADR-0007), and this comparison cannot evaluate `stage === 'sandbox'`. Calling it "NOT
        // DEPLOYED" is a false accusation, and a check that cries wolf is a check that gets deleted.
        expect(
            hasDriftFindings([
                {
                    stackName: 'kitchensink-sandbox-scheduler-prod',
                    condition: "stage === 'sandbox'",
                    present: false,
                    commit: null,
                    handlers: null,
                },
            ]),
        ).toBe(false);
    });

    it('is FALSE for a running handler this commit does not declare', () => {
        // ⛔ Also measured: `kitchensink-data-prod` runs four handlers the source never declares, and all
        // four are CDK's OWN (`framework.onEvent` for each custom resource, plus the bootstrap handlers
        // whose declaration the manifest could not read). `unexpected` answers a different question and has
        // two known blind spots; it is REPORTED, never a failure. `missing` has neither, so it fails.
        expect(
            hasDriftFindings([
                {
                    stackName: 'kitchensink-data-prod',
                    condition: null,
                    present: true,
                    commit: { verdict: 'current' as const, reason: 'ok', deployed: SHA },
                    handlers: { missing: [], unexpected: ['framework.onEvent'], conditional: [], unreadable: [] },
                },
            ]),
        ).toBe(false);
    });

    it('is true for an untagged stack, because unknowable age IS the defect', () => {
        expect(
            hasDriftFindings([
                {
                    stackName: 'kitchensink-x-prod',
                    condition: null,
                    present: true,
                    commit: { verdict: 'untagged' as const, reason: 'no tag', deployed: null },
                    handlers: { missing: [], unexpected: [], conditional: [], unreadable: [] },
                },
            ]),
        ).toBe(true);
    });

    it('is false for a current, complete stack', () => {
        expect(
            hasDriftFindings([
                {
                    stackName: 'kitchensink-x-prod',
                    condition: null,
                    present: true,
                    commit: { verdict: 'current' as const, reason: 'ok', deployed: SHA },
                    handlers: {
                        missing: [],
                        unexpected: [],
                        conditional: [{ logicalId: 'C', handler: 'handlers/c.handler', condition: "stage === 'prod'" }],
                        unreadable: ['X'],
                    },
                },
            ]),
        ).toBe(false);
    });
});

describe('formatDriftReport', () => {
    const report = formatDriftReport(REAL_FINDING);

    it('states the sentence a human can act on', () => {
        expect(report).toContain('kitchensink-recipe-workers-prod');
        expect(report).toContain(OTHER);
        expect(report).toContain(SHA);
        expect(report).toContain('2 declared handler(s) are not running');
    });

    it('names each missing handler with the construct that declares it', () => {
        expect(report).toContain('handlers/verifyLine.handler');
        expect(report).toContain('IngredientVerificationFunction');
    });

    it('reports an absent stack as the loudest finding', () => {
        const absent = formatDriftReport({
            stage: 'prod',
            expected: SHA,
            stacks: [
                { stackName: 'kitchensink-x-prod', condition: null, present: false, commit: null, handlers: null },
            ],
        });

        expect(absent).toContain('is NOT DEPLOYED');
    });

    it('says so plainly when there is nothing to report', () => {
        const clean = formatDriftReport({
            stage: 'prod',
            expected: SHA,
            stacks: [
                {
                    stackName: 'kitchensink-x-prod',
                    condition: null,
                    present: true,
                    commit: { verdict: 'current' as const, reason: 'ok', deployed: SHA },
                    handlers: { missing: [], unexpected: [], conditional: [], unreadable: [] },
                },
            ],
        });

        expect(clean).toContain('No drift');
    });
});
