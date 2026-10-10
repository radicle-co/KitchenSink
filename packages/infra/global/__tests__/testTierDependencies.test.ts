// @vitest-environment node
/**
 * Repo-wide guard: **an integration suite mocks its dependencies, and a LOCAL e2e suite uses real ones**
 * (`docs/CODING_STANDARDS.md` §7.1a, owner ruling 2026-09-20: "Integration tests should mock databases. E2E tests
 * are the only ones that work against real databases").
 *
 * ## Why
 *
 * The tier a suite runs in decides what its green means. A real-database suite in an integration config skipped
 * wherever no database was configured, so a green integration run claimed nothing about it. A fully mocked suite in a
 * LOCAL e2e config passes there for no reason the tier exists for. Both shapes were common: plan 002's X1 moved 155
 * files out of the integration tiers and 5 the other way.
 *
 * ## The declaration, and what this guard verifies
 *
 * A tier's config file name is its one declaration: `vitest.integration.config.ts` is mocked integration,
 * `vitest.e2e.config.ts` is LOCAL e2e, and `vitest.deployed.config.ts` is DEPLOYED e2e. Nothing is guessed from a
 * suite's contents; this guard checks the contents agree with the name. What counts as a door, and which doors are
 * local, is defined once in `realDependencyReach.ts`.
 *
 * ## What is asserted
 *
 * 1. Every tier is discovered from its config under `packages/` and the files its globs reach: nothing is listed by hand.
 * 2. No suite an integration config runs reaches a real dependency. Exactly zero.
 * 3. Every suite a LOCAL config runs reaches one. Exactly zero that do not.
 * 4. No suite a DEPLOYED config runs opens a local door (a database or LocalStack). Its AWS clients reach the deployed
 *    stage, so they are not local.
 * 5. Positive control: the LOCAL configs hold real-dependency suites, so assertions 2 to 4 are not vacuous.
 *
 * ⚠️ What it cannot see: a connection a suite assembles from parts with no door in its text. Reading the connection
 * variables at all is refused separately, by `integrationSubjectRole.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
    type DoorKind,
    LOCAL_DOORS,
    SUITE,
    doorsReached,
    harnessDoorNames,
    reachesRealDependency,
    readTree,
} from './realDependencyReach.js';
import { configReach, tierConfigs } from './roleSplitSources.js';

/** Each tier config with the suites it runs. */
const suitesOf = (fileName: string): readonly { readonly config: string; readonly suites: readonly string[] }[] =>
    tierConfigs(fileName).map((config) => ({
        config,
        suites: configReach(config).filter((path) => SUITE.test(path)),
    }));

/** The door names the fixture rows use, standing in for the harness's derived ones. */
const FIXTURE_DOORS = ['provisionRoleDatabase', 'roleDatabase'] as const;

describe('what reaches a real dependency, and through which door', () => {
    const suite = 'pkg/tests/a.test.ts';
    const s3 = "import { S3Client } from '@aws-sdk/client-s3';";

    it.each<[string, Readonly<Record<string, string>>, readonly DoorKind[], string?]>([
        ['a provisioner call', { [suite]: 'await provisionRoleDatabase(spec);' }, ['database']],
        ['a handle built from the harness', { [suite]: 'const db = roleDatabase(spec);' }, ['database']],
        [
            // A vetted URL connects to nothing: the suite's own pool is its door.
            'a throwaway server URL, vetted and never connected to',
            { [suite]: 'const url = throwawayServerUrl(env);' },
            [],
        ],
        [
            'a door through an imported helper, two levels down',
            {
                [suite]: "import { open } from './support/open.js';",
                'pkg/tests/support/open.ts': "import { db } from './db.js';",
                'pkg/tests/support/db.ts': 'export const db = () => roleDatabase(spec);',
            },
            ['database'],
        ],
        [
            'a door through a side-effect import',
            {
                [suite]: "import './support/boot.js';",
                'pkg/tests/support/boot.ts': 'await provisionRoleDatabase(spec);',
            },
            ['database'],
        ],
        [
            'a door through a dynamic import',
            {
                [suite]: "const { boot } = await import('./support/boot.js');",
                'pkg/tests/support/boot.ts': 'await provisionRoleDatabase(spec);',
            },
            ['database'],
        ],
        [
            'a door through a re-export',
            {
                [suite]: "export { boot } from './support/boot.js';",
                'pkg/tests/support/boot.ts': 'roleDatabase(spec);',
            },
            ['database'],
        ],
        [
            'a door through a helper beside a suite under __integration__/',
            {
                'pkg/src/__integration__/a.integration.test.ts': "import { db } from './db.js';",
                'pkg/src/__integration__/db.ts': 'export const db = () => roleDatabase(spec);',
            },
            ['database'],
            'pkg/src/__integration__/a.integration.test.ts',
        ],
        [
            'a door through a helper under support/ outside tests/',
            {
                'pkg/src/__integration__/a.integration.test.ts': "import { db } from '../support/db.js';",
                'pkg/src/support/db.ts': 'export const db = () => roleDatabase(spec);',
            },
            ['database'],
            'pkg/src/__integration__/a.integration.test.ts',
        ],
        ['a real `pg` pool', { [suite]: "import pg from 'pg';\nnew pg.Pool({ connectionString });" }, ['database']],
        [
            'a `pg` pool over a mocked `pg`',
            { [suite]: "vi.mock('pg', () => ({ Pool: class {} }));\nnew Pool({});" },
            [],
        ],
        ['a LocalStack endpoint read', { [suite]: "const url = process.env['S3_ENDPOINT'];" }, ['localstack']],
        ['the default endpoint read', { [suite]: 'const url = process.env.AWS_ENDPOINT_URL;' }, ['localstack']],
        [
            'a LocalStack-shaped string handed to a mocked client',
            { [suite]: "const queueUrl = 'http://localhost:4566/queue/q';" },
            [],
        ],
        ['an AWS client, constructed', { [suite]: `${s3}\nconst c = new S3Client({});` }, ['awsClient']],
        [
            'an AWS client, renamed on import',
            { [suite]: "import { S3Client as Storage } from '@aws-sdk/client-s3';\nnew Storage({});" },
            ['awsClient'],
        ],
        [
            'an AWS client through a namespace import',
            { [suite]: "import * as sqs from '@aws-sdk/client-sqs';\nnew sqs.SQSClient({});" },
            ['awsClient'],
        ],
        [
            'an AWS client in a helper the suite imports',
            {
                [suite]: "import { client } from './support/s3.js';",
                'pkg/tests/support/s3.ts': `${s3}\nexport const client = new S3Client({});`,
            },
            ['awsClient'],
        ],
        [
            'an AWS client over its mocked module',
            { [suite]: `vi.mock('@aws-sdk/client-s3', () => ({ S3Client: vi.fn() }));\n${s3}\nnew S3Client({});` },
            [],
        ],
        [
            'an AWS client when only ANOTHER AWS module is mocked',
            { [suite]: `vi.mock('@aws-sdk/client-sqs');\n${s3}\nnew S3Client({});` },
            ['awsClient'],
        ],
        [
            'an AWS command, which is not a client',
            { [suite]: "import { GetObjectCommand } from '@aws-sdk/client-s3';\nnew GetObjectCommand({});" },
            [],
        ],
        [
            'a type-only AWS import',
            { [suite]: "import type { S3Client } from '@aws-sdk/client-s3';\nlet c: S3Client | undefined;" },
            [],
        ],
        ['an AWS client named only in a comment', { [suite]: `${s3}\n// new S3Client({})` }, []],
        ['a door named only in a comment', { [suite]: '// we never call roleDatabase(spec) here' }, []],
        [
            'an import of a production module that opens a door, which is not the suite opening one',
            { [suite]: "import { boot } from '../src/boot.js';", 'pkg/src/boot.ts': 'new pg.Pool({});' },
            [],
        ],
        ['a fully mocked suite', { [suite]: "vi.mock('../src/db.js');\nexpect(1).toBe(1);" }, []],
    ])('%s', (_case, files, expected, path = suite) => {
        expect([...doorsReached(path, (file) => files[file], FIXTURE_DOORS)].sort()).toEqual([...expected].sort());
    });
});

describe('the harness door names, derived from its exports', () => {
    const entry = 'harness/src/index.ts';

    /** A fake harness: its entry re-exports `exports` from `./doors.js`, whose source is `doors`. */
    const harness = (exports: string, doors: string) => (path: string) =>
        ({ [entry]: `export { ${exports} } from './doors.js';`, 'harness/src/doors.ts': doors })[path];

    it.each<[string, string, string, readonly string[]]>([
        [
            'an export that builds a pool',
            'open',
            'export function open(url) { return new pg.Pool({ url }); }',
            ['open'],
        ],
        [
            'an export that calls an unexported helper which builds a client',
            'open',
            'function connect(url) { return new pg.Client({ url }); }\nexport function open(url) { return connect(url); }',
            ['open'],
        ],
        [
            'an export that calls another exported door, as an arrow function',
            'open, provision',
            'export function open(url) { return new Pool({ url }); }\nexport const provision = async (url) => { await open(url).end(); };',
            ['open', 'provision'],
        ],
        [
            'an export two calls from the pool, declared before both callees',
            'outer',
            'export function outer() { return middle(); }\nfunction middle() { return inner(); }\nfunction inner() { return new pg.Pool(); }',
            ['outer'],
        ],
        ['an export that connects to nothing', 'decide', 'export function decide(env) { return env.URL; }', []],
        [
            'a door that is not exported',
            'decide',
            'function open(url) { return new pg.Pool({ url }); }\nexport function decide(env) { return env.URL; }',
            [],
        ],
        ['a type-only export', 'type Open', 'export type Open = () => pg.Pool;', []],
        [
            'a pool named only in a comment',
            'decide',
            'export function decide(env) { /* new pg.Pool() */ return env.URL; }',
            [],
        ],
    ])('%s', (_case, exports, doors, expected) => {
        expect([...harnessDoorNames(harness(exports, doors), entry)].sort()).toEqual([...expected].sort());
    });

    it('reads the real harness: its provisioners are doors, and the app booter and the URL rule are not', () => {
        const names = harnessDoorNames(readTree);

        expect(names).toEqual(
            expect.arrayContaining(['provisionRoleDatabase', 'roleDatabase', 'poolForDroppableDatabase']),
        );
        expect(names).not.toContain('bootServiceApp');
        expect(names).not.toContain('decideAdminServerUrl');
    });
});

describe('the test tiers on the tree, each declared by its config file name', () => {
    const integration = suitesOf('vitest.integration.config.ts');
    const local = suitesOf('vitest.e2e.config.ts');
    const deployed = suitesOf('vitest.deployed.config.ts');
    const localSuites = local.flatMap(({ suites }) => suites);

    it('are discovered, so an empty scan cannot pass the assertions below', () => {
        expect(integration.length).toBeGreaterThanOrEqual(10);
        expect(integration.flatMap(({ suites }) => suites).length).toBeGreaterThan(50);
        expect(local.length).toBeGreaterThanOrEqual(5);
        expect(deployed.flatMap(({ suites }) => suites).length).toBeGreaterThanOrEqual(4);
    });

    it('⛔ run no integration suite that reaches a real dependency (the count is exactly zero)', () => {
        const offenders = integration.flatMap(({ suites }) =>
            suites.filter((suite) => reachesRealDependency(suite, readTree)),
        );

        expect(offenders).toEqual([]);
    });

    it('⛔ a LOCAL config (`vitest.e2e.config.ts`) runs only suites that reach a real dependency', () => {
        expect(localSuites.filter((suite) => !reachesRealDependency(suite, readTree))).toEqual([]);
    });

    it('⛔ a DEPLOYED config (`vitest.deployed.config.ts`) runs no suite that opens a local door', () => {
        const offenders = deployed.flatMap(({ suites }) =>
            suites.filter((suite) => [...doorsReached(suite, readTree)].some((kind) => LOCAL_DOORS.has(kind))),
        );

        expect(offenders).toEqual([]);
    });

    it('hold real-dependency suites in the LOCAL configs, the positive control for the assertions above', () => {
        expect(localSuites.filter((suite) => reachesRealDependency(suite, readTree)).length).toBeGreaterThan(200);
    });
});
