// @vitest-environment node
/**
 * Repo-wide guard: NOTHING that runs during a test creates a Clerk user — except the creators this file argues — and
 * the one module that provisions the pool is reached from CI through exactly one door.
 *
 * Owner ruling 2026-09-13, verbatim: "We should have a pool of test users for clerk so that we don't need to create
 * ones". Every tier used to mint its own users — web per shard in `globalSetup`, Maestro three per run, the k6 pool
 * find-or-create, the linkage profile on demand, the legacy food harness per run — and delete them afterwards.
 * Deleting a Clerk user is not data cleanup (its public content survives, pseudonymised) and a cancelled run never
 * deletes at all, so the tiers now LEASE slots of a fixed pool that only `poolAdmin` provisions.
 *
 * ⚠️ AMENDED by owner ruling 2026-10-08, which is stated once, in `poolAdmin.ts`'s header: the Maestro job now runs
 * `poolAdmin` itself, scoped to the erasure subjects, right before it provisions. That changes WHO may invoke the
 * writer, not WHICH code creates — so the file scan below is unchanged, and the second suite pins the one CI door.
 *
 * ## Derived, never enumerated
 *
 * Every tracked source file is scanned — comments blanked, so prose about a creation is not read as one — for the
 * three shapes a creation takes:
 *
 *   - the Backend API SDK: `.createUser(`;
 *   - the Backend API over raw HTTP: a request to a path ending `/users` whose method is `POST`;
 *   - the Frontend API's registration, which `@clerk/testing` and the web helpers drive by attempt kind: `sign_ups`.
 *
 * A file matching any of them must be in {@link CREATORS}, with the reason it may; and every entry there must still
 * match, so a creator that stops creating leaves a stale exemption that fails too. Unit tests are excluded — a mock
 * of `createUser` creates nothing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { isUnitTestFile, repoRoot, trackedFiles } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

/** The files permitted to create a Clerk user, each with the reason. */
const CREATORS: Readonly<Record<string, string>> = {
    'packages/tools/e2e-fixtures/src/poolAdmin.ts':
        'the ONLY provisioner of the fixed test pool, run out of band by the owner, never by a test run',
    'packages/apps/commise/web/tests/e2e/signUp.spec.ts':
        'registration IS the subject under test; its run-scoped users are swept by planE2EUserCleanup, which is ' +
        'asserted never to match a pool slot',
    'packages/apps/commise/web/tests/e2e/utils/clerkFapiStep.ts':
        'types the Frontend API attempt kinds the email-code helper waits on; it issues no request of its own',
};

/** The shapes of a creation. */
const CREATION: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'Backend API SDK createUser', pattern: /\.createUser\(/u },
    {
        name: 'Backend API POST /users',
        pattern: /\/users['"`]\s*,\s*\{[^}]{0,200}?method:\s*['"]POST['"]/u,
    },
    { name: 'Frontend API sign-up attempt', pattern: /['"`/]sign_ups\b/u },
];

/** This guard names every pattern it hunts for, so it is not itself a creator. */
const SELF = 'packages/infra/global/__tests__/runtimeUserCreation.test.ts';

/** Source with block and line comments blanked (URLs inside strings survive: `//` after `:` is kept). */
function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '))
        .replace(/(^|[^:'"`])\/\/.*$/gmu, '$1')
        .replace(/^\s*#.*$/gmu, '');
}

/** Every tracked, non-unit-test source file and the creation shapes it matches. */
function creators(): ReadonlyMap<string, readonly string[]> {
    const files = execFileSync(
        'git',
        ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs', '*.sh', '*.yml', '*.yaml'],
        { cwd: repoRoot, encoding: 'utf8' },
    )
        .split('\n')
        .filter((file) => file !== '' && file !== SELF)
        .filter((file) => !isUnitTestFile(file))
        .filter((file) => !file.includes('node_modules/'));
    const found = new Map<string, readonly string[]>();

    for (const file of files) {
        let source: string;

        try {
            source = code(readFileSync(path.join(repoRoot, file), 'utf8'));
        } catch {
            // Staged for deletion but still in the index: nothing on disk can create anything.
            continue;
        }

        const shapes = CREATION.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);

        if (shapes.length > 0) {
            found.set(file, shapes);
        }
    }

    return found;
}

describe('no test run creates a Clerk user', () => {
    const found = creators();

    it('finds the creators it permits (non-vacuity — discovery still sees a creation)', () => {
        expect(found.has('packages/tools/e2e-fixtures/src/poolAdmin.ts')).toBe(true);
    });

    it('⛔ creates Clerk users only where an argued exemption allows it', () => {
        const unargued = [...found.entries()]
            .filter(([file]) => CREATORS[file] === undefined)
            .map(([file, shapes]) => `${file}: ${shapes.join(', ')}`);

        expect(
            unargued,
            'a test run that creates the user it needs is the shape the fixed pool replaced — lease a slot ' +
                '(@kitchensink/e2e-fixtures/lease) and add a roster lane provisioned by poolAdmin instead',
        ).toStrictEqual([]);
    });

    it('carries no stale exemption — every permitted creator still creates', () => {
        const stale = Object.keys(CREATORS).filter((file) => !found.has(file));

        expect(stale).toStrictEqual([]);
    });

    it('the matchers see each shape of a creation (mutation check on the patterns)', () => {
        const samples = [
            'await clerk.users.createUser({ emailAddress: [email] });',
            "await backend('/users', { method: 'POST', body: JSON.stringify(payload) });",
            "fetch('https://api.clerk.com/v1/users', {\n    method: 'POST',\n    headers,\n});",
            "await submitClerkEmailCode(page, { attempt: 'sign_ups' });",
        ];

        for (const sample of samples) {
            expect(
                CREATION.some(({ pattern }) => pattern.test(code(sample))),
                sample,
            ).toBe(true);
        }

        expect(CREATION.some(({ pattern }) => pattern.test(code('// clerk.users.createUser({})')))).toBe(false);
        expect(CREATION.some(({ pattern }) => pattern.test("await backend('/users?email_address=x');"))).toBe(false);
    });
});

/**
 * The scan's scope. It excludes only UNIT tests: the tooling it polices lives under `tests/` and `__fixtures__/`, so a
 * broader "test file" filter (like `isTestFile`) would silently exempt `tests/e2e/utils/testUser.ts`, the very file
 * that once created a Clerk user per shard.
 */
describe('isUnitTestFile — the scan scope', () => {
    it.each([
        ['packages/tools/e2e-fixtures/__tests__/poolAdmin.test.ts', true],
        ['packages/apps/commise/web/src/components/Thing.test.tsx', true],
        ['scripts/check.test.mjs', true],
        ['packages/apps/commise/web/tests/e2e/utils/testUser.ts', false],
        ['packages/apps/commise/web/tests/e2e/signUp.spec.ts', false],
        ['packages/tools/e2e-seed/src/__fixtures__/world.ts', false],
        ['packages/tools/e2e-fixtures/src/poolAdmin.ts', false],
        ['packages/tools/latest.ts', false],
    ] as const)('%s → %s', (file, unit) => {
        expect(isUnitTestFile(file)).toBe(unit);
    });
});

/**
 * ⛔ THE WRITER'S ONLY CI DOOR (owner ruling 2026-10-08, recorded in `poolAdmin.ts`). A run may top the pool up, but
 * only as the Maestro job's scoped erasure refill. Every other provisioning — a new lane, a re-marked grant, the
 * drift audit — stays the owner's out-of-band run, because a CI step that reconciled the whole roster would create
 * and re-grant users on every push.
 *
 * Discovered, not listed: every workflow step and every tracked shell script whose COMMANDS (comment lines dropped —
 * a comment naming the writer is not a call) invoke `poolAdmin`.
 */
describe('the pool writer is reached from CI only as the scoped Maestro erasure refill', () => {
    /** An invocation of the writer: the script by path, or the workspace script that wraps it. */
    const INVOKES_WRITER = /poolAdmin\.ts\b|pool:admin\b/u;
    /** The one admitted spelling: apply, scoped to one shard's erasure subjects, the shard from the matrix. */
    const REFILL =
        'npx tsx packages/tools/e2e-fixtures/src/poolAdmin.ts --apply --maestro-erasure --shard "${SHARD_INDEX}"';
    /** The jobs that refill — one per Maestro platform. */
    const REFILLING_JOBS = ['_ci-heavy.yml::e2e-mobile-maestro', '_ci-heavy.yml::e2e-mobile-maestro-ios'];

    const commands = (text: string): string =>
        text
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#'))
            .join('\n');

    interface Invocation {
        readonly where: string;
        readonly run: string;
        readonly shardIndex: string;
    }

    const invocations = (): readonly Invocation[] => {
        const fromWorkflows = trackedFiles(WORKFLOWS_DIR)
            .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
            .flatMap((file) => {
                const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                    jobs?: Record<string, { steps?: readonly { run?: unknown; env?: Record<string, unknown> }[] }>;
                } | null;

                return Object.entries(doc?.jobs ?? {}).flatMap(([job, body]) =>
                    (body.steps ?? [])
                        .filter((step) => INVOKES_WRITER.test(commands(scalarText(step.run))))
                        .map((step) => ({
                            where: `${path.basename(file)}::${job}`,
                            run: commands(scalarText(step.run)).trim(),
                            shardIndex: scalarText(step.env?.['SHARD_INDEX']),
                        })),
                );
            });
        const fromScripts = execFileSync('git', ['ls-files', '--', '*.sh'], { cwd: repoRoot, encoding: 'utf8' })
            .split('\n')
            .filter((file) => file !== '')
            .flatMap((file) => {
                let source: string;

                try {
                    source = readFileSync(path.join(repoRoot, file), 'utf8');
                } catch {
                    return [];
                }

                return INVOKES_WRITER.test(commands(source))
                    ? [{ where: file, run: '(shell script)', shardIndex: '' }]
                    : [];
            });

        return [...fromWorkflows, ...fromScripts];
    };

    const found = invocations();

    it('finds the refill in both Maestro jobs (non-vacuity — discovery still sees an invocation)', () => {
        expect(found.map((invocation) => invocation.where)).toStrictEqual(REFILLING_JOBS);
    });

    it('⛔ every CI invocation is the scoped refill, with its shard from the matrix — never the whole roster', () => {
        for (const invocation of found) {
            expect(invocation.run, invocation.where).toBe(REFILL);
            expect(invocation.shardIndex, `${invocation.where} does not take SHARD_INDEX from the matrix`).toMatch(
                /^\$\{\{\s*matrix\.shard\s*\}\}$/u,
            );
        }
    });

    it('the matcher sees each spelling of an invocation and ignores a comment (mutation check)', () => {
        for (const sample of [
            'npx tsx packages/tools/e2e-fixtures/src/poolAdmin.ts --apply',
            'npm run pool:admin --workspace=packages/tools/e2e-fixtures -- --apply',
        ]) {
            expect(INVOKES_WRITER.test(commands(sample)), sample).toBe(true);
        }

        expect(INVOKES_WRITER.test(commands('# the refill runs poolAdmin.ts before provision'))).toBe(false);
    });
});
