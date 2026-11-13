// @vitest-environment node
/**
 * Repo-wide guard: every CDK app installs from a committed lockfile, with `npm ci`.
 *
 * ## The failure this pins
 *
 * The CDK apps live outside the npm workspace, each with its own manifest and `node_modules`. None had a lockfile, and
 * every workflow installed them with `npm install`, which resolves the manifest's ranges again on every run. So the
 * same commit synthesized against a different `aws-cdk-lib` from one run to the next: when 2.277.0 was published with
 * a newer Node runtime, cdk-nag's `AwsSolutions-L1` began to call every pinned `nodejs24.x` Lambda "not latest", and a
 * commit that passed in the morning failed in the afternoon with no change in this repository.
 *
 * ## What is asserted
 *
 * 1. Every CDK app directory has a `package-lock.json` that git tracks. A file that exists only on one machine does not
 *    count.
 * 2. No workflow or composite action runs an npm verb that can write the lockfile in a package outside the root
 *    workspace (a CDK app, or any package that commits its own lockfile). It is an allowlist: `npm ci` installs exactly
 *    the lockfile and fails when it no longer matches the manifest, while `npm install` and its kin rewrite it in
 *    silence. Every CDK app is installed by at least one step.
 * 3. Every CDK app's lockfile resolves one version of each shared CDK package.
 *
 * Both sides are discovered. The apps come from `cdkAppDirectories()`, which reads them out of the tree by content, and
 * each command's target comes from `commandsOf()`, shared with `installWorkspaceRestoreFirst.test.ts`: a step
 * `working-directory`, `--prefix` with a literal path or a loop variable over the app globs, a `cd`, and a composite
 * action's `${{ inputs.directory }}` resolved through its callers.
 *
 * ## What it does not read
 *
 * It reads only workflows and composite actions, never TypeScript or shell scripts. `local:up` installs CDK apps from
 * TypeScript, and its own unit test (`local-sandbox` `installMissingCdkDependencies.test.ts`) pins `npm ci` there. A
 * `package.json` script that runs a file (`sh scripts/x.sh`, `node x.mjs`) which installs is not seen either. A loop
 * is read when its header ends in `;` or a new line before `do`; a header split any other way is not seen. A loop
 * over a glob list (quoted or not) resolves to the package directories its globs match. A loop over a command
 * substitution (`$(...)`) or an array (`"${arr[@]}"`) resolves to no directory (decision 0205): its commands are not
 * judged here, and the root-install refusal that `installWorkspaceRestoreFirst.test.ts` applies to them holds only in
 * the files that guard scans (the deploy-path files and resolve-sandbox), not repo-wide.
 *
 * DESIGN PATTERN: Specification module over the parsed workflow and action files.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
    ACTIONS_DIR,
    actionInputValues,
    cdkAppDirectories,
    commandsOf,
    loopHeaders,
    ownLockfileDirectories,
    WORKFLOWS_DIR,
    type InstallStep,
    type StepCommand,
} from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

interface Step extends InstallStep {
    readonly name?: string;
}

interface StepSite {
    readonly where: string;
    readonly step: Step;
    /** The composite action's reference, for a step that belongs to one. */
    readonly action?: string;
}

/**
 * Every step a runner executes, from each workflow job and each composite action.
 *
 * @sideEffect Reads the tracked workflow and action files.
 */
function stepSites(): readonly StepSite[] {
    const files = [...trackedFiles(WORKFLOWS_DIR), ...trackedFiles(ACTIONS_DIR)].filter((file) =>
        /\.ya?ml$/u.test(file),
    );

    return files.flatMap((file) => {
        const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
            jobs?: Record<string, { steps?: Step[] }>;
            runs?: { steps?: Step[] };
        } | null;
        const fromJobs = Object.entries(doc?.jobs ?? {}).flatMap(([job, { steps }]) =>
            (steps ?? []).map((step) => ({ where: `${file} › ${job} › ${step.name ?? '(unnamed)'}`, step })),
        );
        const action = `./${path.posix.dirname(file)}`;
        const fromAction = (doc?.runs?.steps ?? []).map((step) => ({
            where: `${file} › ${step.name ?? '(unnamed)'}`,
            step,
            action,
        }));

        return [...fromJobs, ...fromAction];
    });
}

/**
 * A command that installs, updates or adds a dependency: npm, pnpm or yarn, or `npx --yes`, which fetches a package.
 * Any `package.json` script may run under an admitted verb (`run` reaches every script, and `test`, `pack`, `publish`
 * and `version` run their lifecycle scripts), so the invariant is on the scripts themselves (decision 0206).
 */
const INSTALLS =
    /\b(?:npm\s+(?:ci|install|in|i|add|update|up)\b|pnpm\s+(?:install|i|add|update|up)\b|yarn(?:\s+(?:install|add|upgrade)\b|\s*(?:$|&&|;|\|))|npx\s+(?:--yes|-y)\b)/u;

/** The names of the scripts in a manifest that install, update or add a dependency. Pure. */
const installingScripts = (scripts: Readonly<Record<string, string>> = {}): readonly string[] =>
    Object.entries(scripts)
        .filter(([, text]) => INSTALLS.test(text))
        .map(([name]) => name);

/**
 * The npm verbs that may run in a directory with a committed lockfile. A verb joins only if it cannot resolve or change
 * a dependency, itself or through a lifecycle script it runs. Every other verb is refused, so `install`, its aliases
 * (`i`, `add`, `isntall` ...) and `update` need no list of their own, and an option before the verb
 * (`npm --prefix <app> install`) makes the first word an option and is refused too (decisions 0205 and 0206).
 *
 * `test`, `pack`, `publish` and `version` run only in `shared/infra`, the published library, which has no `version` or
 * `publish` hook and whose `prepack` runs only `npm run build`. `version` stamps the lockfile's root version field and
 * resolves nothing. ⚠️ If an installing lifecycle script is ever added there, these four admissions must be reconsidered.
 */
const LOCKFILE_SAFE_VERBS: ReadonlySet<string> = new Set([
    'ci',
    'run',
    'exec',
    'ls',
    'test',
    'pack',
    'publish',
    'version',
]);

/** An npm command's verb: the first word after `npm`, or `undefined` for a command that is not npm. */
const npmVerb = (text: string): string | undefined => /^npm\s+(\S+)/u.exec(text)?.[1];

/** The npm commands of a step that run in one of `directories` with a verb that can write a lockfile. */
function refusedNpmCommands(commands: readonly StepCommand[]): readonly string[] {
    return commands
        .filter(({ text, inDirectories }) => {
            const verb = npmVerb(text);

            // `npm exec` and `npx` run any command, so one that runs an install is refused like the install itself.
            const runsAnInstall = (verb === 'exec' || /^npx\s/u.test(text)) && INSTALLS.test(text);

            return inDirectories && (runsAnInstall || (verb !== undefined && !LOCKFILE_SAFE_VERBS.has(verb)));
        })
        .map(({ text }) => text);
}

/** The version of `name` a lockfile resolves at the top of its tree. */
const lockedVersion = (lockfile: Lockfile, name: string): string | undefined =>
    lockfile.packages?.[`node_modules/${name}`]?.version;

interface Lockfile {
    readonly packages?: Readonly<Record<string, { readonly version?: string }>>;
}

/** The CDK packages every app must resolve to one version of, or L1 turns red on some apps and not others. */
const SHARED_CDK_PACKAGES = ['aws-cdk-lib', 'aws-cdk', 'cdk-nag', 'constructs', '@radicle-co/infra-shared'] as const;

/** Each shared package that the given lockfiles do not resolve to exactly one version, with the versions seen. */
function splitVersions(lockfiles: readonly Lockfile[]): Readonly<Record<string, readonly (string | undefined)[]>> {
    return Object.fromEntries(
        SHARED_CDK_PACKAGES.map(
            (name) => [name, [...new Set(lockfiles.map((file) => lockedVersion(file, name)))]] as const,
        ).filter(([, versions]) => versions.length !== 1),
    );
}

describe('every CDK app installs from a committed lockfile', () => {
    const apps = cdkAppDirectories();
    const packages = new Set([...apps, ...ownLockfileDirectories()]);

    it('discovers the CDK apps (non-vacuity)', () => {
        expect(apps).toContain('packages/infra/global');
        expect(apps.length).toBeGreaterThan(1);
    });

    it('tracks a package-lock.json in every CDK app directory', () => {
        const missing = apps.filter((app) => !trackedFiles(app).includes(`${app}/package-lock.json`));

        expect(missing, 'these CDK apps have no lockfile in git, so CI resolves their ranges afresh').toEqual([]);
    });

    it('runs no lockfile-writing npm verb in a package with its own lockfile, and installs every CDK app', () => {
        // The CDK apps and every other package with its own lockfile: an action shared by both kinds of caller is then
        // judged as installing them, rather than escaping because one caller is not a CDK app.
        const inputs = actionInputValues();
        const commands = stepSites().map(({ where, step, action }) => ({
            where,
            commands: commandsOf(step, packages, action === undefined ? undefined : inputs.get(action)),
        }));
        const offenders = commands.flatMap(({ where, commands: each }) =>
            refusedNpmCommands(each).map((text) => `${where}: ${text}`),
        );
        const installed = new Set(
            commands.flatMap(({ commands: each }) =>
                each.filter(({ text }) => npmVerb(text) === 'ci').flatMap(({ targets }) => targets),
            ),
        );

        // Non-vacuity: a reader that stops resolving the loops, the only installer of several apps, fails here.
        expect(apps.filter((app) => !installed.has(app))).toEqual([]);
        expect(offenders, 'only ci, run, exec and ls may run where a lockfile is committed').toEqual([]);
    });

    it('has no installing script in any package with its own lockfile', () => {
        const found = [...packages].flatMap((dir) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as {
                scripts?: Record<string, string>;
            };

            return installingScripts(manifest.scripts).map((name) => `${dir}: ${name}`);
        });

        expect(found, 'a script here can run under an admitted npm verb and rewrite the lockfile').toEqual([]);
    });

    it('resolves one version of each shared CDK package across every app', () => {
        const lockfiles = apps.map(
            (app) => JSON.parse(readFileSync(path.join(repoRoot, app, 'package-lock.json'), 'utf8')) as Lockfile,
        );

        expect(splitVersions(lockfiles)).toEqual({});
    });
});

describe('the lockfile verb allowlist', () => {
    const app = 'packages/infra/global';
    const packages = new Set([app]);

    it.each([
        `npm install --prefix ${app}`,
        `npm i --prefix ${app}`,
        `npm add left-pad --prefix ${app}`,
        `npm update --prefix ${app}`,
        `npm --prefix ${app} install`,
        `npm install --prefix ./${app}`,
        `for app in ${app}; do npm install --prefix "$app"; done`,
        `cd ${app} && npm exec -- npm install`,
        `cd ${app} && npx npm install`,
    ])('refuses %s', (run) => {
        expect(refusedNpmCommands(commandsOf({ run }, packages))).not.toEqual([]);
    });

    it.each([`npm ci --prefix ${app}`, `npm run infra:synth --prefix ${app}`])('admits %s', (run) => {
        expect(refusedNpmCommands(commandsOf({ run }, packages))).toEqual([]);
    });
});

describe('the shared CDK version set', () => {
    const lock = (cdk: string): Lockfile => ({
        packages: Object.fromEntries(
            SHARED_CDK_PACKAGES.map((name) => [
                `node_modules/${name}`,
                { version: name === 'aws-cdk-lib' ? cdk : '1.0.0' },
            ]),
        ),
    });

    it('is whole when every lockfile agrees', () => {
        expect(splitVersions([lock('2.275.0'), lock('2.275.0')])).toEqual({});
    });

    it('reports a lockfile that resolves a different aws-cdk-lib', () => {
        expect(splitVersions([lock('2.275.0'), lock('2.277.0')])).toEqual({ 'aws-cdk-lib': ['2.275.0', '2.277.0'] });
    });
});

describe('a loop over CDK app globs installs inside the app set', () => {
    const packages = new Set(cdkAppDirectories());

    it.each([
        ['a glob list', 'for app in packages/infra/global packages/services/*/infra; do npm ci --prefix "$app"; done'],
        // The exact shape of the CDK install loop in `_ci.yml`, so a parser change that breaks the real loop fails here.
        [
            'the real CDK install loop',
            [
                'for app in packages/infra/global packages/apps/*/*/infra packages/services/*/infra; do',
                '    [ -f "${app}/package.json" ] || continue',
                '    echo "::group::${app}"',
                '    npm ci --prefix "${app}" --no-audit --no-fund',
                '    echo "::endgroup::"',
                'done',
            ].join('\n'),
        ],
        [
            'a quoted list',
            'for app in "packages/infra/global" "packages/services/*/infra"; do npm ci --prefix "$app"; done',
        ],
        [
            'do on the next line',
            'for app in packages/infra/global packages/services/*/infra\ndo\n  npm ci --prefix "$app"\ndone',
        ],
    ])('resolves %s', (_form, run) => {
        const installs = commandsOf({ run }, packages).filter(({ text }) => npmVerb(text) === 'ci');

        expect(installs).toHaveLength(1);
        expect(installs[0]?.inDirectories).toBe(true);
        expect(installs[0]?.targets.length).toBeGreaterThan(1);
    });
});

// A loop header's list and the blanks around it must not both match the same whitespace, or a header padded with
// blanks and no terminator takes time quadratic in its length (CodeQL js/polynomial-redos). Each loop form a guard
// relies on keeps its (variable, list) reading, and `do` on the next line counts as well as `; do`.
describe('loopHeaders reads every loop form, in linear time', () => {
    it.each([
        [
            'a glob list',
            'for d in packages/*/infra packages/infra/global; do\n  npm ci --prefix "$d"\ndone',
            'packages/*/infra packages/infra/global',
        ],
        [
            'a quoted list',
            'for d in "packages/infra/global" "packages/infra/alb"; do echo "$d"; done',
            '"packages/infra/global" "packages/infra/alb"',
        ],
        ['a command substitution', 'for d in $(git ls-files infra); do echo "$d"; done', '$(git ls-files infra)'],
        ['an array expansion', 'for d in "${apps[@]}"; do echo "$d"; done', '"${apps[@]}"'],
        ['do on the next line', 'for d in packages/infra/global\ndo\n  echo "$d"\ndone', 'packages/infra/global'],
        [
            'blanks before the terminator',
            'for d in packages/infra/global  ;  do echo "$d"; done',
            'packages/infra/global',
        ],
    ])('reads %s', (_form, run, list) => {
        expect(loopHeaders(run)).toEqual([{ variable: 'd', list }]);
    });

    it('reads no loop from a header with no terminator', () => {
        expect(loopHeaders('for d in packages/infra/global')).toEqual([]);
    });

    it('gives up on a long unterminated blank run at once', () => {
        const run = `for d in ${'\t '.repeat(5_000)}x`;
        const started = performance.now();

        expect(loopHeaders(run)).toEqual([]);
        expect(performance.now() - started).toBeLessThan(250);
    });
});

describe('installingScripts', () => {
    it.each([
        ['a prepack that runs npm install', { prepack: 'npm install' }],
        ['a build that adds a package', { build: 'tsc && npm add left-pad' }],
        ['npm in', { setup: 'npm in' }],
        ['npm up', { refresh: 'npm up' }],
        ['npm ci', { fresh: 'npm ci' }],
        ['a pnpm install', { prepare: 'pnpm install' }],
        ['a bare yarn', { prepare: 'yarn' }],
        ['npx --yes', { gen: 'npx --yes some-tool' }],
        ['npm i', { setup: 'npm i' }],
        ['npm update', { refresh: 'npm update' }],
        ['npx npm install', { setup: 'npx npm install' }],
        ['npm exec -- npm install', { setup: 'npm exec -- npm install' }],
        ['a yarn install', { prepare: 'yarn install' }],
    ])('reports %s', (_label, scripts) => {
        expect(installingScripts(scripts)).toEqual(Object.keys(scripts));
    });

    it('admits scripts that build, test or run other scripts', () => {
        expect(
            installingScripts({
                prepack: 'npm run build',
                build: 'tsc -p .',
                test: 'vitest run',
                init: 'npm init -y',
                y: 'yarn build',
            }),
        ).toEqual([]);
    });
});
