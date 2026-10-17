// @vitest-environment node
/**
 * Repo-wide guard: the catalog seed step runs AFTER the food migration and BEFORE anything that reads the catalog
 * deploys, never continues on error, and applies the bundle the pipeline built (curated catalog plan U3, U7, U10, R37,
 * KTD-4).
 *
 * The seed writes into the schema the migration just moved, so before it the seed writes into last release's schema;
 * after the service deploy, the service serves a catalog the seed has not yet written. A seed that continues on error
 * lets the service deploy over a half-applied seed. A seed that names another directory digests a bundle the
 * function does not hold, and refuses — or, worse, a bundle no step built.
 *
 * Two pipelines run the seed, and each is read as written: the shared deploy action (previews) and `prod-deploy.yml`.
 * Both must also invoke every seed function a stack publishes, discovered from the stack source: a published output
 * that no pipeline invokes is a seed that never runs. Each rule is fired at fixtures that break it as well as at the
 * tree.
 *
 * DESIGN PATTERN: Specification module over pure predicates ({@link seedStepViolations},
 * {@link seedOutputViolations}).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { readRepoFile, stackSources } from './migrationRunners.js';
import { repoRoot } from './serviceSources.js';

/** One step as the guard reads it. */
interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly if?: string;
    readonly 'continue-on-error'?: unknown;
}

/** Where the seed sits in one pipeline: the steps to find, by name. */
interface SeedPipeline {
    readonly label: string;
    readonly steps: readonly Step[];
    /** The food migration step. */
    readonly migrate: RegExp;
    /** The seed step. */
    readonly seed: RegExp;
    /** The first step that deploys what reads the catalog. */
    readonly consumerDeploy: RegExp;
    /** What the seed step's command must name as its bundle. */
    readonly bundle: RegExp;
    /** The command that builds the bundle, when this pipeline builds it in a step of its own. */
    readonly build?: RegExp;
    /** The step that confirms, after the deploy, that the database records the seed the deployed function holds. */
    readonly confirm: RegExp;
    /** A condition the seed step's gate must include, when the bundle is built by a step that runs only under it. */
    readonly builtUnder?: string;
}

/**
 * Every way one pipeline can misplace or weaken its seed step.
 *
 * @param pipeline - The pipeline and the steps to find.
 * @returns One message per violation. Pure.
 */
export function seedStepViolations(pipeline: SeedPipeline): readonly string[] {
    const indexOf = (pattern: RegExp): number => pipeline.steps.findIndex((step) => pattern.test(step.name ?? ''));
    const migrate = indexOf(pipeline.migrate);
    const seed = indexOf(pipeline.seed);
    const consumer = indexOf(pipeline.consumerDeploy);

    if (seed < 0) {
        return [`${pipeline.label}: has no catalog seed step`];
    }

    const step = pipeline.steps[seed] ?? {};
    const violations: string[] = [];

    if (migrate < 0 || seed < migrate) {
        violations.push(`${pipeline.label}: the seed step does not follow the food migration`);
    }

    if (consumer < 0 || seed > consumer) {
        violations.push(`${pipeline.label}: the seed step does not precede the deploy that reads the catalog`);
    }

    if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== false) {
        violations.push(`${pipeline.label}: the seed step continues on error, so a failed seed deploys the service`);
    }

    if (!/runSeed\.sh run\b/u.test(step.run ?? '')) {
        violations.push(`${pipeline.label}: the seed step does not run \`runSeed.sh run\``);
    }

    if (!pipeline.bundle.test(step.run ?? '')) {
        violations.push(`${pipeline.label}: the seed step does not apply the built seed bundle`);
    }

    const confirm = indexOf(pipeline.confirm);
    const confirmStep = pipeline.steps[confirm];

    if (confirmStep === undefined || confirm < consumer) {
        violations.push(
            `${pipeline.label}: no step confirms the seed is current after the deploy, so a deploy that ships a new ` +
                'seed function without applying it goes unnoticed',
        );
    } else {
        if (!/runSeed\.sh describe\b/u.test(confirmStep.run ?? '')) {
            violations.push(`${pipeline.label}: the confirm step does not run \`runSeed.sh describe\``);
        }

        if (confirmStep['continue-on-error'] !== undefined && confirmStep['continue-on-error'] !== false) {
            violations.push(`${pipeline.label}: the confirm step continues on error`);
        }
    }

    if (pipeline.builtUnder !== undefined && !(step.if ?? '').includes(pipeline.builtUnder)) {
        violations.push(
            `${pipeline.label}: the seed step is not gated on \`${pipeline.builtUnder}\`, so it can apply a bundle no ` +
                'step built',
        );
    }

    if (pipeline.build !== undefined) {
        const buildPattern = pipeline.build;
        const build = pipeline.steps.findIndex((candidate) => buildPattern.test(candidate.run ?? ''));
        const builder = pipeline.steps[build];

        if (builder === undefined || build > seed) {
            violations.push(`${pipeline.label}: no step builds the seed bundle before the seed step`);
        } else if ((builder.if ?? '') !== (step.if ?? '')) {
            violations.push(
                `${pipeline.label}: the seed step is gated differently from the step that builds its bundle, so it ` +
                    'can apply a bundle this run did not build',
            );
        }
    }

    return violations;
}

/** A seed function's output, as a stack declares it. */
const SEED_OUTPUT = /new CfnOutput\(\s*this,\s*'([A-Za-z]+SeedFunctionName)'/gu;

/**
 * Every seed function output the given stack sources publish.
 *
 * @param read - Reads one source file.
 * @param files - The stack sources.
 * @returns The output ids, sorted. Pure over `read`.
 */
export function publishedSeedOutputs(read: (file: string) => string, files: readonly string[]): readonly string[] {
    const found = files.flatMap((file) => [...read(file).matchAll(SEED_OUTPUT)].map((match) => match[1] ?? ''));

    return [...new Set(found)].filter((name) => name.length > 0).sort();
}

/**
 * Every seed function output a pipeline leaves unreached. A published output that no pipeline invokes is a seed
 * function that never runs, while every check on the output itself stays green.
 *
 * @param outputs - The published seed outputs.
 * @param prodSeedRun - The command of prod's seed step.
 * @param deployInfra - The text of the workflow that hands the preview action its seed output.
 * @returns One message per unreached output and pipeline. Pure.
 */
export function seedOutputViolations(
    outputs: readonly string[],
    prodSeedRun: string,
    deployInfra: string,
): readonly string[] {
    return outputs.flatMap((output) => [
        ...(new RegExp(`\\b${output}\\b`, 'u').test(prodSeedRun) ? [] : [`prod-deploy.yml does not invoke ${output}`]),
        ...(new RegExp(`^\\s*seed-export: ${output}$`, 'mu').test(deployInfra)
            ? []
            : [`deployInfra.yml does not pass seed-export: ${output}`]),
        ...(new RegExp(`^\\s*seed-ref: [a-z-]+:${output}$`, 'mu').test(deployInfra)
            ? []
            : [`deployInfra.yml does not pass a seed-ref naming ${output} to the job that deploys it again`]),
    ]);
}

/** The steps of a workflow job or a composite action, read from YAML. */
function stepsOf(file: string, job?: string): readonly Step[] {
    const document = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
        readonly runs?: { readonly steps?: readonly Step[] };
        readonly jobs?: Readonly<Record<string, { readonly steps?: readonly Step[] }>>;
    };

    return job === undefined ? (document.runs?.steps ?? []) : (document.jobs?.[job]?.steps ?? []);
}

/** The job of `prod-deploy.yml` that holds the food steps. */
function prodFoodJob(): string {
    const document = parse(readFileSync(path.join(repoRoot, '.github/workflows/prod-deploy.yml'), 'utf8')) as {
        readonly jobs: Readonly<Record<string, { readonly steps?: readonly Step[] }>>;
    };
    const job = Object.entries(document.jobs).find(([, body]) =>
        (body.steps ?? []).some((step) => /Run food DB migrations/u.test(step.name ?? '')),
    );

    return job?.[0] ?? '';
}

/** The two pipelines that seed, as the tree holds them. */
function pipelines(): readonly SeedPipeline[] {
    return [
        {
            label: '.github/actions/infra-package/action.yml',
            steps: stepsOf('.github/actions/infra-package/action.yml'),
            migrate: /^Run migrations$/u,
            seed: /^Apply the catalog seed$/u,
            consumerDeploy: /^Deploy$/u,
            bundle: /"\$\{SEED_BUNDLE_DIR\}"/u,
            confirm: /^Confirm the catalog seed is current$/u,
            builtUnder: "inputs.synth == 'true'",
        },
        {
            label: '.github/workflows/prod-deploy.yml',
            steps: stepsOf('.github/workflows/prod-deploy.yml', prodFoodJob()),
            migrate: /^Run food DB migrations/u,
            seed: /^Apply the food catalog seed/u,
            consumerDeploy: /^CDK Deploy \(food service\)/u,
            bundle: /packages\/services\/food-service\/distSeed\b/u,
            build: /npm run bundle:lambda --workspace=packages\/services\/food-service\b/u,
            confirm: /^Confirm the food catalog seed is current/u,
        },
    ];
}

describe('the catalog seed runs between the migration and the catalog’s readers', () => {
    it('finds both pipelines and their food steps, so the rule below is not vacuous', () => {
        for (const pipeline of pipelines()) {
            expect(pipeline.steps.length, pipeline.label).toBeGreaterThan(3);
        }
    });

    it('⛔ holds in the tree', () => {
        expect(pipelines().flatMap(seedStepViolations)).toStrictEqual([]);
    });

    it('the deploy action’s food leg passes the built seed bundle', () => {
        const deployInfra = readFileSync(path.join(repoRoot, '.github/workflows/deployInfra.yml'), 'utf8');

        expect(deployInfra).toMatch(/seed-bundle-dir: packages\/services\/food-service\/distSeed\n/u);
    });

    it('⛔ invokes every seed function a stack publishes, in both pipelines', () => {
        const outputs = publishedSeedOutputs(readRepoFile, stackSources());
        const prodSeed = stepsOf('.github/workflows/prod-deploy.yml', prodFoodJob()).find((step) =>
            /^Apply the food catalog seed/u.test(step.name ?? ''),
        );

        expect(outputs.length).toBeGreaterThan(0);
        expect(
            seedOutputViolations(outputs, prodSeed?.run ?? '', readRepoFile('.github/workflows/deployInfra.yml')),
        ).toStrictEqual([]);
    });
});

describe('the output rule fires — at pipelines that leave a seed function unreached', () => {
    const prod = 'bash .github/scripts/runSeed.sh run "${DEFAULT_AWS_REGION}" "s" FoodSeedFunctionName food dir';
    const deployInfra =
        '                  seed-export: FoodSeedFunctionName\n                  seed-ref: kitchensink-food-schema:FoodSeedFunctionName\n';

    it.each<[string, readonly string[], string, string, string]>([
        [
            'a second seed output prod never invokes',
            ['FoodSeedFunctionName', 'RecipeSeedFunctionName'],
            prod,
            deployInfra,
            'prod-deploy.yml does not invoke RecipeSeedFunctionName',
        ],
        [
            'a seed output the redeploying job never confirms',
            ['FoodSeedFunctionName'],
            prod,
            '                  seed-export: FoodSeedFunctionName\n',
            'deployInfra.yml does not pass a seed-ref naming FoodSeedFunctionName to the job that deploys it again',
        ],
        [
            'a seed output the previews never name',
            ['FoodSeedFunctionName'],
            prod,
            'seed-export: FoodMigrationFunctionName\n',
            'deployInfra.yml does not pass seed-export: FoodSeedFunctionName',
        ],
        [
            'a prod seed step that names another output',
            ['FoodSeedFunctionName'],
            prod.replace('FoodSeedFunctionName', 'FoodMigrationFunctionName'),
            deployInfra,
            'prod-deploy.yml does not invoke FoodSeedFunctionName',
        ],
    ])('catches %s', (_case, outputs, prodRun, deployInfraText, message) => {
        expect(seedOutputViolations(outputs, prodRun, deployInfraText)).toContain(message);
    });

    it('finds a seed output in stack source, and nothing else', () => {
        const sources: Readonly<Record<string, string>> = {
            'a.ts': "new CfnOutput(this, 'FoodSeedFunctionName', { value: seedFn.functionName });",
            'b.ts': "new CfnOutput(this, 'FoodMigrationFunctionName', { value: fn.functionName });",
        };

        expect(publishedSeedOutputs((file) => sources[file] ?? '', ['a.ts', 'b.ts'])).toStrictEqual([
            'FoodSeedFunctionName',
        ]);
    });

    it('passes when every output is invoked', () => {
        expect(seedOutputViolations(['FoodSeedFunctionName'], prod, deployInfra)).toStrictEqual([]);
    });
});

describe('the rule fires — at pipelines built to break it', () => {
    const migrate: Step = { name: 'Run migrations', run: 'bash .github/scripts/runMigrations.sh run r s o l d' };
    const seed: Step = {
        name: 'Apply the catalog seed',
        run: 'bash .github/scripts/runSeed.sh run r s o l "${SEED_BUNDLE_DIR}"',
    };
    const deploy: Step = { name: 'Deploy', run: 'npm run deploy' };
    const confirm: Step = {
        name: 'Confirm the catalog seed is current',
        run: 'bash .github/scripts/runSeed.sh describe r s o l',
    };
    const fake = (steps: readonly Step[]): SeedPipeline => ({
        label: 'fake.yml',
        steps,
        migrate: /^Run migrations$/u,
        seed: /^Apply the catalog seed$/u,
        consumerDeploy: /^Deploy$/u,
        bundle: /"\$\{SEED_BUNDLE_DIR\}"/u,
        confirm: /^Confirm the catalog seed is current$/u,
    });

    it.each<[string, readonly Step[], string]>([
        ['a seed moved before the migration', [seed, migrate, deploy], 'does not follow the food migration'],
        ['a seed moved after the deploy', [migrate, deploy, seed], 'does not precede the deploy'],
        ['a removed seed', [migrate, deploy], 'has no catalog seed step'],
        [
            'a seed that continues on error',
            [migrate, { ...seed, 'continue-on-error': true }, deploy],
            'continues on error',
        ],
        [
            'a seed that names another bundle',
            [migrate, { ...seed, run: 'bash .github/scripts/runSeed.sh run r s o l dist' }, deploy],
            'built seed bundle',
        ],
        [
            'a seed that only describes',
            [
                migrate,
                { ...seed, run: 'bash .github/scripts/runSeed.sh describe r s o l "${SEED_BUNDLE_DIR}"' },
                deploy,
            ],
            'does not run',
        ],
        ['a removed confirm step', [migrate, seed, deploy], 'no step confirms the seed is current'],
        ['a confirm step before the deploy', [migrate, seed, confirm, deploy], 'no step confirms the seed is current'],
        [
            'a confirm step that applies instead of describing',
            [migrate, seed, deploy, { ...confirm, run: 'bash .github/scripts/runSeed.sh run r s o l d' }],
            'does not run `runSeed.sh describe`',
        ],
        [
            'a confirm step that continues on error',
            [migrate, seed, deploy, { ...confirm, 'continue-on-error': true }],
            'the confirm step continues on error',
        ],
    ])('catches %s', (_case, steps, message) => {
        const found = seedStepViolations(fake(steps));

        expect(found.length).toBeGreaterThan(0);
        expect(found.join('\n')).toContain(message);
    });

    it.each<[string, readonly Step[], string]>([
        [
            'a seed with no build step before it',
            [migrate, { ...seed, if: 'x' }, deploy],
            'no step builds the seed bundle',
        ],
        [
            'a seed gated differently from its build',
            [
                { name: 'Bundle', run: 'npm run bundle:lambda --workspace=w', if: 'a' },
                migrate,
                { ...seed, if: 'b' },
                deploy,
            ],
            'gated differently',
        ],
    ])('catches %s, where the pipeline builds the bundle itself', (_case, steps, message) => {
        const found = seedStepViolations({ ...fake(steps), build: /npm run bundle:lambda --workspace=w\b/u });

        expect(found.join('\n')).toContain(message);
    });

    it('catches a seed step gated without the condition its bundle is built under', () => {
        const found = seedStepViolations({
            ...fake([migrate, { ...seed, if: "inputs.deploy == 'true'" }, deploy, confirm]),
            builtUnder: "inputs.synth == 'true'",
        });

        expect(found.join('\n')).toContain("is not gated on `inputs.synth == 'true'`");
    });

    it('passes a well-formed pipeline', () => {
        expect(seedStepViolations(fake([migrate, seed, deploy, confirm]))).toStrictEqual([]);
    });
});
