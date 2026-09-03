// @vitest-environment node
/**
 * Repo-wide guard: a workflow that PROBES a CDK app's stacks must probe ALL of them.
 *
 * ## The failure this pins
 *
 * `sandbox-identity-deploy.yml` decides whether to redeploy the shared sandbox platform by asking
 * CloudFormation whether its stacks exist. It asked about TWO of them, by name. Its own comment records the
 * first correction: ADR-0028 made `kitchensink-alb-sandbox` reclaimable, a reaped tier left the network stack
 * standing, the probe answered "nothing is missing", the global deploy was skipped, and the identity deploy
 * then died resolving `SharedAlbHttpsListenerArn` from a stack that no longer existed. The ALB was added to
 * the list.
 *
 * ⛔ Adding it fixed the INSTANCE and left the CLASS wide open. `GlobalStack` owns seven children plus the
 * app-level stacks around it — data, domain, global, messaging, service-logs and the sandbox scheduler were
 * all still unprobed, and a stack added tomorrow would have been too. **A copy of a list cannot detect that
 * the list is incomplete** (ADR-0025 §3), and this is the third time this repository has paid for that shape
 * after the ALB priority collision and the stale NAT-consumer table.
 *
 * ## What is derived, and from what
 *
 * Both sides:
 *
 *   - the PROBES come from the workflows' own text — every step that calls `describe-stacks` or
 *     `deploy-gate.sh evaluate`, which are the only two things in this repository that ask whether a stack is
 *     there. A step is the unit, so a locally-defined `stack_exists()` wrapper is covered without this guard
 *     knowing its name.
 *   - the DECLARATIONS come from `deploy-gate.sh stacks-for`, EXECUTED rather than re-implemented. That is
 *     the same derivation the workflows themselves now use, so this guard cannot pass a workflow that the
 *     deploy would fail, or vice versa — and the condition vocabulary (`stage === '<literal>'`) has exactly
 *     one definition, in bash, instead of one here and one there.
 *
 * A probed name that no CDK app declares is its own finding: it can never be present, so the gate it feeds
 * deploys on every single event, forever, for a reason nobody would look for.
 *
 * ## Mutation evidence
 *
 * Written against the tree BEFORE `sandbox-identity-deploy.yml` was converted to the derived probe, and
 * watched fail there — naming `kitchensink-data-sandbox`, `kitchensink-domain-sandbox`,
 * `kitchensink-global-sandbox`, `kitchensink-messaging-sandbox`, `kitchensink-sandbox-scheduler-sandbox` and
 * `kitchensink-service-logs-sandbox` as declared-but-unprobed. Deleting `kitchensink-food-service-${STAGE}`
 * from `sandbox-deploy.yml`'s food gate reds it again, and so does misspelling any probed name.
 *
 * DESIGN PATTERN: Specification module over two derivations — what a workflow probes, and what the app
 * declares — compared for completeness, exactly as `deployVerificationCoverage.test.ts` does for deploy and
 * verify one level up.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { WORKFLOWS_DIR, foldContinuations, toSourceEntrypoint, withoutComments, workflowJobs } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** The gate script that owns the derivation both this guard and the workflows read. */
const GATE = path.join(repoRoot, '.github/scripts/deploy-gate.sh');

/**
 * The two things in this repository that ask CloudFormation whether a stack is there.
 *
 * `deploy-gate.sh evaluate` calls `describe-stacks` itself, one file down; naming both spellings is what
 * makes the STEP the unit of discovery rather than the call.
 */
const PROBE_MARKER = /describe-stacks|deploy-gate\.sh\s+evaluate/u;

/** A literal stack name, possibly carrying a shell variable for the stage. */
const STACK_TOKEN =
    /kitchensink-(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z0-9])(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z0-9-])*/gu;

/**
 * A CDK app entrypoint named anywhere in a workflow, in either spelling.
 *
 * ⚠️ Deliberately NOT "the argument to `stacks-for`". The identity gate hands that argument through a shell
 * function, so the literal sits at the CALL SITE and the call itself reads `stacks-for "$1"` — a rule written
 * around the invocation would have had to be taught to ignore `$1`, which is how a guard learns to ignore the
 * thing it was written for. Every path a workflow names is the honest subject, and it covers `--app` too.
 */
const APP_ENTRYPOINT = /packages\/[A-Za-z0-9@._/-]*bin\/app\.(?:ts|js)/gu;

/** One step that probes for stacks, with everything needed to judge it. */
interface Probe {
    readonly workflow: string;
    readonly job: string;
    readonly step: string;
    /** The literal stack names it names, with shell variables expanded. */
    readonly names: readonly string[];
    /** Tokens this guard could not resolve to a concrete name. */
    readonly unresolved: readonly string[];
}

/**
 * The `env:` blocks a workflow declares, at file level and per job.
 *
 * @param file - Repo-relative workflow path.
 * @returns The workflow env and the per-job envs. Impure.
 * @sideEffect Reads the workflow file.
 */
function environments(file: string): {
    readonly workflow: Record<string, string>;
    readonly jobs: Record<string, Record<string, string>>;
} {
    const document = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
        env?: Record<string, string>;
        jobs?: Record<string, { env?: Record<string, string> }>;
    };

    return {
        workflow: document.env ?? {},
        jobs: Object.fromEntries(Object.entries(document.jobs ?? {}).map(([name, job]) => [name, job.env ?? {}])),
    };
}

/**
 * Reduce a workflow `env:` value to the stage it names.
 *
 * ⚠️ An `${{ … }}` expression collapses to `N`, so `pr-${{ github.event.pull_request.number }}` reads as
 * `pr-N` — this repository's own notation for an ephemeral per-PR stage. That is the honest reading and not a
 * placeholder: no stack in this repository is guarded on an ephemeral stage (the three conditional ones are
 * `stage === 'prod'` twice and `stage === 'sandbox'` once), so the representative token resolves the same set
 * the real value would. If that ever stops being true, `stacks-for` refuses on the guard rather than guessing.
 *
 * ⚠️ The expression body is matched LAZILY to the first `}}`, not as "anything but a brace". The real value
 * is `${{ github.event.inputs.stage || format('pr-{0}', …) }}`, whose `{0}` closes a brace in the middle — a
 * `[^}]*` reading stopped there and handed the rest of the expression through as if it were a stack name.
 *
 * @param value - The raw `env:` value, or undefined.
 * @returns The stage, or undefined when the key is absent. Pure.
 */
function toStage(value: string | undefined): string | undefined {
    return value === undefined ? undefined : value.replace(/\$\{\{[\s\S]*?\}\}/gu, 'N').trim();
}

/**
 * Expand `${VAR}` / `$VAR` in a probed stack name from the step's environment.
 *
 * @param token - The raw token.
 * @param env - The variables in scope, job env taking precedence over workflow env.
 * @returns The concrete name, or the token unchanged when a variable has no value. Pure.
 */
function expand(token: string, env: Record<string, string>): string {
    return token.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (whole, name: string) => env[name] ?? whole);
}

/** Every step in every workflow that asks whether a stack exists. */
function probes(): readonly Probe[] {
    const allJobs = workflowJobs();

    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const workflow = path.basename(file);
            const env = environments(file);

            const scope = (job: string): Record<string, string> => {
                const merged = { ...env.workflow, ...(env.jobs[job] ?? {}) };

                return Object.fromEntries(
                    Object.entries(merged).flatMap(([key, value]) => {
                        const stage = toStage(String(value));

                        return stage === undefined ? [] : [[key, stage]];
                    }),
                );
            };

            return allJobs
                .filter((job) => job.workflow === workflow)
                .flatMap((job) =>
                    foldContinuations(job.body)
                        .split(/^\s*- name: /mu)
                        .filter((step) => PROBE_MARKER.test(step))
                        .map((step) => {
                            const expanded = [...step.matchAll(STACK_TOKEN)].map((match) =>
                                expand(match[0], scope(job.name)),
                            );

                            return {
                                workflow,
                                job: job.name,
                                step: (step.split('\n')[0] ?? '').trim(),
                                names: [...new Set(expanded.filter((name) => !name.includes('$')))],
                                unresolved: [...new Set(expanded.filter((name) => name.includes('$')))],
                            };
                        }),
                );
        });
}

/** Every `stackNameTemplate` the committed manifest carries, with the app that declares it. */
function declarations(): readonly { readonly entrypoint: string; readonly template: string }[] {
    const manifest = JSON.parse(
        readFileSync(path.join(repoRoot, 'docs/generated/infrastructure/manifest.json'), 'utf8'),
    ) as { apps: { entrypoint: string; stacks: { stackNameTemplate: string | null }[] }[] };

    return manifest.apps.flatMap((app) =>
        app.stacks.flatMap((stack) =>
            stack.stackNameTemplate === null || stack.stackNameTemplate.includes('{?}')
                ? []
                : [{ entrypoint: app.entrypoint, template: stack.stackNameTemplate }],
        ),
    );
}

/**
 * Attribute one probed stack name to the app that declares it, and the stage it names.
 *
 * @param name - A concrete stack name.
 * @returns The matches — zero means nobody declares it, more than one means the name is ambiguous. Pure.
 */
function attribute(name: string): readonly { readonly entrypoint: string; readonly stage: string }[] {
    return declarations().flatMap(({ entrypoint, template }) => {
        const pattern = new RegExp(
            `^${template.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\\\{[A-Za-z_][A-Za-z0-9_]*\\\}/gu, '(.+)')}$`,
            'u',
        );
        const match = pattern.exec(name);

        return match === null ? [] : [{ entrypoint, stage: match[1] ?? '' }];
    });
}

/**
 * The stacks an app declares for a stage, from the gate script itself.
 *
 * @param entrypoint - Repo-relative `bin/app.ts`.
 * @param stage - The stage to resolve.
 * @returns The declared names.
 * @throws {Error} when the script refuses — a refusal is never an empty set.
 * @sideEffect Spawns `bash`.
 */
function declaredFor(entrypoint: string, stage: string): readonly string[] {
    const result = spawnSync('bash', [GATE, 'stacks-for', entrypoint, stage], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_WORKSPACE: repoRoot },
    });

    if (result.status !== 0) {
        throw new Error(`deploy-gate.sh stacks-for ${entrypoint} ${stage} refused: ${result.stderr.trim()}`);
    }

    return result.stdout.split('\n').flatMap((line) => (line.trim() === '' ? [] : [line.trim()]));
}

describe('stack-existence probes name every stack the app declares', () => {
    it('discovers real probe steps across the real workflows', () => {
        // ⛔ Anti-vacuity. A step splitter that silently matched nothing would make every assertion below
        // pass — the failure `cdkAppDeployCoverage.test.ts` caught in itself on its first run.
        const found = probes();

        expect(found.length).toBeGreaterThan(2);
        expect(new Set(found.map((probe) => probe.workflow))).toContain('sandbox-deploy.yml');
        expect(found.flatMap((probe) => probe.names).length).toBeGreaterThan(2);
    });

    it('⛔ probes EVERY stack the app declares, never a hand-picked subset', () => {
        const incomplete = probes().flatMap((probe) => {
            // One group per (app, stage) the step names, so an app probed through two of its stacks is
            // judged once. Compared field by field rather than through a joined key: a separator is a
            // format nobody needs here, and the wrong one silently merges two apps into one verdict.
            const named = probe.names.flatMap((name) => attribute(name));
            const groups = named.filter(
                (group, index) =>
                    named.findIndex((other) => other.entrypoint === group.entrypoint && other.stage === group.stage) ===
                    index,
            );

            return groups.flatMap(({ entrypoint, stage }) => {
                const missing = declaredFor(entrypoint, stage).filter((name) => !probe.names.includes(name));

                return missing.length === 0
                    ? []
                    : [
                          `${probe.workflow}:${probe.job} — step "${probe.step}" probes ${entrypoint} at stage ` +
                              `${stage} but never asks about ${missing.join(', ')}. An absent stack this step ` +
                              'does not name reads as "nothing is missing", so the deploy that would have ' +
                              'created it is skipped. Derive the set with `deploy-gate.sh stacks-for` instead ' +
                              'of listing it.',
                      ];
            });
        });

        expect(incomplete).toEqual([]);
    });

    it('⛔ probes no stack name that this repository does not declare', () => {
        // A misspelled name is absent forever, so the gate it feeds deploys on every event — green, wasteful,
        // and for a reason nobody would go looking for. Ambiguity is a finding for the same reason: the guard
        // above would then judge the step against a set that may not be the one the step meant.
        const wrong = probes().flatMap((probe) => [
            ...probe.unresolved.map(
                (token) =>
                    `${probe.workflow}:${probe.job} — step "${probe.step}" probes "${token}", whose stage this ` +
                    'guard cannot resolve, so nothing here can say whether the set is complete',
            ),
            ...probe.names.flatMap((name) => {
                const matches = attribute(name);

                if (matches.length === 1) {
                    return [];
                }

                return [
                    `${probe.workflow}:${probe.job} — step "${probe.step}" probes "${name}", which ` +
                        (matches.length === 0
                            ? 'no CDK app in this repository declares'
                            : `${String(matches.length)} apps could declare`),
                ];
            }),
        ]);

        expect(wrong).toEqual([]);
    });

    it('⛔ every CDK app a workflow names is one the committed manifest carries', () => {
        // The other half of the derivation. `stacks-for` refuses an entrypoint the manifest does not carry,
        // so a typo fails the deploy loudly — which is the right direction, twenty minutes too late. This is
        // the same answer at build time, and it also catches a manifest that has fallen behind a renamed app
        // while every `--app` in the workflows still points at the old path.
        const apps = new Set(declarations().map((declaration) => declaration.entrypoint));
        const bogus = trackedFiles(WORKFLOWS_DIR)
            .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
            .flatMap((file) => {
                const yaml = withoutComments(readFileSync(path.join(repoRoot, file), 'utf8'));

                return [...new Set([...yaml.matchAll(APP_ENTRYPOINT)].map((match) => toSourceEntrypoint(match[0])))]
                    .filter((entrypoint) => !apps.has(entrypoint))
                    .map(
                        (entrypoint) =>
                            `${path.basename(file)} names the CDK app "${entrypoint}", which the committed ` +
                            'manifest does not carry — run `npm run infra:manifest`, or fix the path',
                    );
            });

        expect(bogus).toEqual([]);
    });

    it('is not vacuous: the workflows really do name CDK apps', () => {
        const named = trackedFiles(WORKFLOWS_DIR)
            .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
            .flatMap((file) => [
                ...withoutComments(readFileSync(path.join(repoRoot, file), 'utf8')).matchAll(APP_ENTRYPOINT),
            ]);

        expect(named.length).toBeGreaterThan(5);
    });
});
