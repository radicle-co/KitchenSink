/**
 * ⛔ EVERY AWS CALL ANY DEPLOYED LAMBDA IN THIS REPOSITORY MAKES IS ONE ITS ROLE ALLOWS.
 *
 * `__tests__/lambdaRolesCoverTheirSdkCalls.test.ts` holds the sandbox scheduler's two functions to this, because the
 * midnight reclaim failed on its first night for a missing `cloudformation:ListStacks`. This is the same check over
 * EVERY CDK app: each app is synthesized in a child process (`tests/common/everyAppSynthesis.ts`, so each stack is
 * built by its own `aws-cdk-lib`), every `AWS::Lambda::Function` is read out of the templates, mapped to the source
 * its bundle was built from, and the SDK calls reachable from that source ({@link sdkPermissionsReachedFrom}) are held
 * against the statements on its synthesized role.
 *
 * ## What is derived, and what is written down
 *
 * Nothing is listed per function. The functions are whatever the templates contain; a handler's source is its CDK
 * `handler:` string under the owning package's `src/` (every bundle is built with `outbase: 'src'`); the apps are
 * discovered. Four things ARE written, each a reviewed exception with its reason, and each is checked from the other
 * side so it cannot go stale: {@link HANDLER_SOURCE_OVERRIDES}, {@link CDK_MANAGED_FUNCTIONS}, {@link ACCEPTED_GAPS}
 * and the Python exclusion.
 *
 * ## Where a mapping cannot be derived, this FAILS
 *
 * An unknown managed policy, a role outside its template, a handler with no source, a function that is neither ours
 * nor CDK's, an SDK client with no IAM prefix, an SDK import that does not resolve: each throws with the function named.
 * A guard that skips what it cannot map is green over exactly what it was written to judge.
 *
 * ## Two stages
 *
 * Production synthesizes the persistent tier and every service. The sandbox scheduler and the per-PR database reaper
 * exist only OUTSIDE production, and a per-PR service refuses the sandbox stage, so a second pass synthesizes at
 * `sandbox` and retries what refused it at `pr-1`. The "every bundled handler is judged" test is the check that
 * the two passes together left no bundled handler unjudged.
 *
 * ## What this does NOT see
 *
 * - Only `new <Name>Command(…)` is a call. `@aws-sdk/lib-storage` `Upload`, `rds-signer`'s `Signer` and the presigners
 *   have no Command class; a handler using one needs its grant reviewed by hand (a document-client command is
 *   refused outright, see `sdkCommandReach.ts`).
 * - Only the direction "the code's calls are granted" is held here. The converse (the role grants nothing the code
 *   does not call) is held for the scheduler stack alone: a role also carries what the Lambda SERVICE needs (queue
 *   consumption, VPC network interfaces, log delivery) and what the runtime reads (`rds-db:connect`, secrets), none of
 *   which is an SDK command in source.
 * - A Python Lambda: the reach analysis reads TypeScript. {@link PYTHON_EXCLUSION} says why that one is safe.
 *
 * @pattern Specification — a predicate over a subject set discovered from synthesis, with every exemption argued
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repoRoot, presentFiles, visit } from '../__tests__/serviceSources.js';
import {
    handlerSource,
    lambdaFunctionsOf,
    missingFrom,
    type CfnTemplate,
    type SynthesizedLambda,
} from '../__tests__/lambdaRoleReach.js';
import { packageProgram, sdkPermissionsReachedFrom } from '../__tests__/sdkCommandReach.js';
import {
    ACCOUNT,
    REGION,
    UNSYNTHESIZABLE,
    prepareWorkspace,
    removeSynthesisScratch,
    stackTemplates,
    synthesizable,
    synthesizeEveryApp,
} from './common/everyAppSynthesis.js';

const env = { account: ACCOUNT, region: REGION };
const PACKAGES_DIR = path.join(repoRoot, 'packages');
const GLOBAL_PACKAGE_DIR = path.join(PACKAGES_DIR, 'infra', 'global');

/**
 * Bundled handlers whose source is NOT `src/<handler module>.ts` under their package, keyed
 * `<package dir, repo-relative>` then the CDK `handler:` string.
 *
 * The Lambda@Edge verifier is bundled by its own `build()` in `infra/global/esbuild.mjs` with
 * `outbase: 'src/edge-verifier'`, so `handler.handler` is `src/edge-verifier/handler.ts`. It is checked against the
 * esbuild file below: an override whose entry the build no longer lists fails.
 */
const HANDLER_SOURCE_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    'packages/infra/global': { 'handler.handler': 'src/edge-verifier/handler.ts' },
};

/**
 * Functions CDK itself adds, whose roles and code are the library's, not ours. Matched on the logical id (or, for the
 * provider framework, the handler), and every pattern must match something real: see the test that checks that.
 */
const CDK_MANAGED_FUNCTIONS: readonly {
    readonly pattern: RegExp;
    readonly of: 'logicalId' | 'handler';
    readonly reason: string;
}[] = [
    {
        pattern: /^Custom[A-Za-z0-9]*CustomResourceProviderHandler[0-9A-F]{8}$/u,
        of: 'logicalId',
        reason: "the S3 auto-delete provider `autoDeleteObjects: true` adds; its role is CDK's (s3:DeleteObject*, GetBucket*, List*)",
    },
    {
        pattern: /^framework\.(?:onEvent|isComplete|onTimeout)$/u,
        of: 'handler',
        reason: "`custom_resources.Provider`'s framework functions; they invoke OUR handler (lambda:InvokeFunction) and make no other call",
    },
];

/**
 * An SDK call this guard reads from the source that the role does not allow, ACCEPTED because the call cannot run in
 * that function or is granted by a path the template does not show. Keyed
 * `<repo-relative handler source>|<action>`; the value is the reason, which must say WHY it is safe.
 *
 * ⛔ Empty by design today. An entry is a reviewed change with its own diff, and one that stops matching a real gap
 * fails 'accepts no gap that has closed'.
 */
const ACCEPTED_GAPS: Readonly<Record<string, string>> = {};

/**
 * Why a Python Lambda is not judged by the TypeScript reach analysis, and what stands in for it.
 *
 * `ingredient-parser` is the repository's only non-Node deployable (ADR-0025) and has no AWS SDK dependency: the test
 * below reads its `.py` files and fails if one imports `boto3`/`botocore`, which is the thing that would make its role
 * matter. It is also {@link UNSYNTHESIZABLE} offline, so it is never in the templates this reads.
 */
const PYTHON_EXCLUSION = 'src/*.py imports no boto3/botocore, so the role has no SDK call to cover';

/**
 * Optional synth inputs the harness's shared environment leaves unset, supplied here so the role that is judged is the
 * role the OPTIONAL feature runs with.
 *
 * `RECIPE_CLOUDFRONT_DISTRIBUTION_ID` is read by `recipe-workers`' app and no workflow sets it today. Unset, the
 * account-erasure worker's CDN adapter logs and skips the call (`createCloudFrontInvalidation`), and the stack adds no
 * `cloudfront:CreateInvalidation` grant: consistent, so nothing is denied. Set, it calls and the stack scopes the
 * grant to that one distribution. Synthesizing it unset would report the grant "missing" for a call that is never
 * made; synthesizing it set judges the state in which the call IS made. The id is a stub: it names nothing.
 */
const OPTIONAL_INPUTS_SUPPLIED: Readonly<Record<string, string>> = {
    RECIPE_CLOUDFRONT_DISTRIBUTION_ID: 'EEXAMPLEDISTRIB',
};

interface JudgedFunction {
    readonly app: string;
    readonly stage: string;
    readonly stack: string;
    readonly fn: SynthesizedLambda;
    /** Repo-relative source of the handler, or the CDK-managed reason. */
    readonly source?: string;
    readonly cdkManaged?: string;
}

/** `<root>/infra/bin/app.ts` and `<root>/bin/app.ts` → the package that owns the handlers' source. */
const packageRootOf = (app: string): string =>
    app.replace(/\/infra\/bin\/app\.ts$/u, '').replace(/\/bin\/app\.ts$/u, '');

const cdkManagedReason = (fn: SynthesizedLambda): string | undefined =>
    CDK_MANAGED_FUNCTIONS.find((candidate) => candidate.pattern.test(fn[candidate.of]))?.reason;

/**
 * Every app synthesized, at production and then at the non-production stage each one accepts.
 *
 * @returns The functions, each with its stage. Impure.
 * @sideEffect Builds the workspace and runs every CDK entrypoint, up to three times.
 */
function synthesizedFunctions(): {
    readonly functions: readonly JudgedFunction[];
    readonly stagesByApp: ReadonlyMap<string, readonly string[]>;
} {
    prepareWorkspace();

    const passes: { readonly stage: string; readonly app: string; readonly outdir: string }[] = [];
    const stagesByApp = new Map<string, string[]>();

    const take = (stage: string, apps: readonly string[]): readonly string[] => {
        const refused: string[] = [];

        for (const synthesis of synthesizeEveryApp({ ...OPTIONAL_INPUTS_SUPPLIED, STAGE: stage }, apps)) {
            if (synthesis.failure === undefined) {
                passes.push({ stage, app: synthesis.app, outdir: synthesis.outdir });
                stagesByApp.set(synthesis.app, [...(stagesByApp.get(synthesis.app) ?? []), stage]);
            } else if (stage === 'prod' || stage === 'pr-1') {
                // Production and the last-resort stage MUST work for an app; only the middle one may refuse.
                throw new Error(`${synthesis.app} would not synthesize at ${stage}:\n${synthesis.failure}`);
            } else {
                refused.push(synthesis.app);
            }
        }

        return refused;
    };

    take('prod', synthesizable);
    take('pr-1', take('sandbox', synthesizable));

    return {
        stagesByApp,
        functions: passes.flatMap(({ stage, app, outdir }) =>
            [...stackTemplates(outdir)].flatMap(([stack, template]) =>
                lambdaFunctionsOf(template as CfnTemplate, env).map((fn): JudgedFunction => {
                    const managed = cdkManagedReason(fn);

                    if (managed !== undefined) {
                        return { app, stage, stack, fn, cdkManaged: managed };
                    }

                    const packageDir = packageRootOf(app);
                    const source = handlerSource(
                        path.join(repoRoot, packageDir),
                        fn.handler,
                        HANDLER_SOURCE_OVERRIDES[packageDir] ?? {},
                    );

                    return { app, stage, stack, fn, source: path.relative(repoRoot, source) };
                }),
            ),
        ),
    };
}

/** The `entryPoints` string literals one `esbuild.mjs` bundles, read with the TypeScript parser. */
function bundledEntryPoints(esbuildFile: string): readonly string[] {
    const source = ts.createSourceFile(esbuildFile, readFileSync(esbuildFile, 'utf8'), ts.ScriptTarget.Latest, true);
    const entries: string[] = [];

    visit(source, (node) => {
        const array =
            (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'entryPoints'
                ? node.initializer
                : undefined) ??
            (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'entryPoints'
                ? node.initializer
                : undefined);

        if (array !== undefined && ts.isArrayLiteralExpression(array)) {
            entries.push(...array.elements.filter(ts.isStringLiteralLike).map((element) => element.text));
        }
    });

    return entries;
}

let functions: readonly JudgedFunction[] = [];
let stagesByApp: ReadonlyMap<string, readonly string[]> = new Map();
let reachOf: ReadonlyMap<string, ReturnType<typeof sdkPermissionsReachedFrom>> = new Map();

/**
 * Synthesize, then read the SDK calls reachable from every distinct handler source with ONE program (one type-check,
 * not one per handler).
 *
 * @sideEffect Builds the workspace, runs the CDK apps, and reads the TypeScript of every handler and what it imports.
 */
beforeAll(() => {
    ({ functions, stagesByApp } = synthesizedFunctions());

    const sources = [...new Set(functions.flatMap(({ source }) => (source === undefined ? [] : [source])))].sort();
    const program = packageProgram(
        GLOBAL_PACKAGE_DIR,
        sources.map((source) => path.join(repoRoot, source)),
    );

    reachOf = new Map(
        sources.map((source) => [
            source,
            sdkPermissionsReachedFrom(program, path.join(repoRoot, source), PACKAGES_DIR),
        ]),
    );
}, 900_000);

afterAll(removeSynthesisScratch);

describe('the synthesized functions are read, not assumed', () => {
    it('finds functions in every synthesizable app', () => {
        const withFunctions = new Set(functions.map(({ app }) => app));

        // An app with no Lambda is allowed to exist; an app that SYNTHESIZED and is absent from the census of
        // apps is not — that would be this guard looking at fewer apps than the repository has.
        expect([...stagesByApp.keys()].sort()).toEqual([...synthesizable].sort());
        expect(withFunctions.size).toBeGreaterThanOrEqual(5);
        expect(functions.filter(({ source }) => source !== undefined).length).toBeGreaterThanOrEqual(25);
    });

    it('classifies every function as ours or as CDK-managed, never as neither', () => {
        expect(
            functions
                .filter(({ source, cdkManaged }) => source === undefined && cdkManaged === undefined)
                .map(({ app, stack, fn }) => `${app} ${stack}/${fn.logicalId}`),
        ).toEqual([]);
    });

    it('keeps every CDK-managed pattern pointing at something real', () => {
        const matched = new Set(functions.flatMap(({ cdkManaged }) => (cdkManaged === undefined ? [] : [cdkManaged])));

        expect(
            CDK_MANAGED_FUNCTIONS.filter((candidate) => !matched.has(candidate.reason)).map((c) => c.reason),
        ).toEqual([]);
    });

    it('reaches SDK calls from the handlers that obviously make them, so the comparison below is not vacuous', () => {
        const actionsOf = (source: string): readonly string[] =>
            (reachOf.get(source) ?? []).map(({ action }) => action);

        expect(actionsOf('packages/infra/global/src/sandbox-scheduler/reclaimHandler.ts')).toContain(
            'cloudformation:DeleteStack',
        );
        expect(actionsOf('packages/services/identity-webhooks/src/handlers/deletionWorker.ts').length).toBeGreaterThan(
            0,
        );
        expect(
            [...reachOf.values()].filter((permissions) => permissions.length > 0).length,
            'most handlers make at least one SDK call',
        ).toBeGreaterThanOrEqual(10);
    });
});

describe('every bundled handler is judged', () => {
    const BUNDLED_ENTRY_POINTS_ARE_ALL_JUDGED =
        'every entry point an esbuild.mjs bundles is the source of a synthesized function';

    it(BUNDLED_ENTRY_POINTS_ARE_ALL_JUDGED, () => {
        const judged = new Set(functions.flatMap(({ source }) => (source === undefined ? [] : [source])));
        const unjudged = presentFiles(['packages/**/esbuild.mjs'])
            .filter((file) => !file.includes('/node_modules/'))
            .flatMap((file) => {
                const packageDir = path.posix.dirname(file);

                return bundledEntryPoints(path.join(repoRoot, file)).map((entry) => path.posix.join(packageDir, entry));
            })
            .filter((entry) => !judged.has(entry));

        expect(
            unjudged,
            'bundled but never the code of a synthesized function: dead, or a stage this guard did not synthesize',
        ).toEqual([]);
    });

    it('accepts no handler-source override whose target the build does not bundle', () => {
        const bundled = presentFiles(['packages/**/esbuild.mjs']).flatMap((file) =>
            bundledEntryPoints(path.join(repoRoot, file)).map((entry) =>
                path.posix.join(path.posix.dirname(file), entry),
            ),
        );

        expect(
            Object.entries(HANDLER_SOURCE_OVERRIDES)
                .flatMap(([packageDir, byHandler]) =>
                    Object.values(byHandler).map((src) => path.posix.join(packageDir, src)),
                )
                .filter((src) => !bundled.includes(src)),
        ).toEqual([]);
    });
});

describe('⛔ every function role admits every AWS call its code makes', () => {
    const judged = (): readonly JudgedFunction[] => functions.filter(({ source }) => source !== undefined);

    it('admits them all, on every stage that was synthesized', () => {
        const failures = judged().flatMap(({ app, stage, stack, fn, source }) =>
            missingFrom(fn.statements, reachOf.get(source ?? '') ?? [], env)
                .filter((missing) => ACCEPTED_GAPS[`${source}|${missing.split(' ')[0]}`] === undefined)
                .map(
                    (missing) => `${path.basename(packageRootOf(app))} ${stage} ${stack}/${fn.logicalId} -> ${missing}`,
                ),
        );

        expect(failures, 'these functions will be denied at run time').toEqual([]);
    });

    it('accepts no gap that has closed', () => {
        const live = new Set(
            judged().flatMap(({ fn, source }) =>
                missingFrom(fn.statements, reachOf.get(source ?? '') ?? [], env).map(
                    (missing) => `${source}|${missing.split(' ')[0]}`,
                ),
            ),
        );

        expect(Object.keys(ACCEPTED_GAPS).filter((key) => !live.has(key))).toEqual([]);
    });

    it('can fail: a role with every statement removed is missing everything its code calls', () => {
        const withCalls = judged().find(({ source }) => (reachOf.get(source ?? '') ?? []).length > 0);

        expect(withCalls).toBeDefined();
        expect(
            missingFrom([], reachOf.get(withCalls?.source ?? '') ?? [], env).length,
            'the comparison reports nothing against an empty policy, so it cannot be trusted to report anything',
        ).toBe((reachOf.get(withCalls?.source ?? '') ?? []).length);
    });
});

describe('the Python Lambda is excluded for a stated reason', () => {
    it(`holds: ${PYTHON_EXCLUSION}`, () => {
        expect(Object.keys(UNSYNTHESIZABLE)).toEqual(['packages/services/ingredient-parser/infra/bin/app.ts']);

        const python = presentFiles(['packages/services/ingredient-parser/src/*.py']);

        expect(python.length, 'the Python source is where this test looks').toBeGreaterThan(0);

        for (const file of python) {
            const imports = readFileSync(path.join(repoRoot, file), 'utf8')
                .split('\n')
                .filter((line) => /^\s*(?:import|from)\s+(?:boto3|botocore|aioboto)/u.test(line));

            expect(imports, `${file} reaches AWS through the SDK, so its role must be judged`).toEqual([]);
        }

        expect(functions.filter(({ fn }) => fn.runtime.startsWith('python'))).toEqual([]);
    });
});
