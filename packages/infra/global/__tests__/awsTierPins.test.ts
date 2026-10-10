// @vitest-environment node
/**
 * Every test tier that can build an AWS client pins the AWS environment, and pins the right one: a LOCAL e2e config
 * applies the LOCAL pin (LocalStack on this machine), and an integration config applies the integration pin (a refused
 * endpoint). Both come from `@kitchensink/service-test-harness`, whose `awsPin.ts` says why the credentials are the
 * load-bearing half.
 *
 * ⛔ IT ENUMERATES NOTHING. The configs are `tierConfigs()`, and a config is in scope when its package can reach an AWS
 * SDK: it declares an `@aws-sdk/*` package, or a workspace package it declares does at run time (`dependencies` or
 * `peerDependencies`). A new tier, or a new package that starts using AWS, is covered the day it lands.
 *
 * ⛔ IT READS THE RESOLVED CONFIG, NOT ITS TEXT, AND LOADS IT AS VITEST DOES. Each config is loaded by vite's own
 * `loadConfigFromFile`, which bundles the config and leaves its package imports to Node, so a config that vitest cannot
 * load fails here too. Its `test.env` and `test.setupFiles` must carry every entry of the pin: an entry overridden after
 * the spread, or a pin imported and never spread, fails. CI runs no LOCAL e2e tier, so this is the one CI check that a
 * LOCAL config loads at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { INTEGRATION_AWS_PIN } from '@kitchensink/service-test-harness/integration-aws-pin';
import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';
import { loadConfigFromFile } from 'vite';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, tierConfigs } from './roleSplitSources.js';

/** The part of a pin a config must carry. */
interface Pin {
    readonly env: Readonly<Record<string, string>>;
    readonly setupFiles: readonly string[];
}

/** The part of a resolved vitest config this guard reads. */
interface TierTest {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly setupFiles?: unknown;
}

/** The parts of a `package.json` this guard reads. */
interface Manifest {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Reads a package's manifest by its repo-relative directory, or `undefined` when there is none. */
type ManifestReader = (directory: string) => Manifest | undefined;

const AWS_SDK = /^@aws-sdk\//u;

/**
 * Whether a package can reach an AWS SDK: it declares one in any dependency field, or a workspace package it declares
 * does in `dependencies` or `peerDependencies`, transitively. A workspace package's `devDependencies` are its own tests'
 * business and do not travel. Pure over `read`.
 *
 * @param directory - The package's repo-relative directory.
 * @param read - Reads a manifest.
 * @param workspaces - Workspace package names, mapped to their directories.
 * @returns `true` when the package can construct an AWS client.
 */
function reachesAwsSdk(directory: string, read: ManifestReader, workspaces: ReadonlyMap<string, string>): boolean {
    const seen = new Set<string>();
    const pending: (readonly [string, boolean])[] = [[directory, true]];

    while (pending.length > 0) {
        const [next, isRoot] = pending.pop() ?? ['', false];

        if (seen.has(next)) {
            continue;
        }

        seen.add(next);

        const manifest = read(next);
        const names = Object.keys({
            ...manifest?.dependencies,
            ...manifest?.peerDependencies,
            ...(isRoot ? manifest?.devDependencies : {}),
        });

        if (names.some((name) => AWS_SDK.test(name))) {
            return true;
        }

        for (const name of names) {
            const workspace = workspaces.get(name);

            if (workspace !== undefined) {
                pending.push([workspace, false]);
            }
        }
    }

    return false;
}

/**
 * What a resolved tier config lacks of a pin, one finding per entry. Pure.
 *
 * @param test - The config's `test` block.
 * @param pin - The pin it must apply.
 * @returns The findings; empty when the pin is applied whole.
 */
function pinFindings(test: TierTest, pin: Pin): readonly string[] {
    const setupFiles: readonly unknown[] = Array.isArray(test.setupFiles) ? test.setupFiles : [test.setupFiles];
    const findings = Object.entries(pin.env)
        .filter(([key, value]) => test.env?.[key] !== value)
        .map(
            ([key, value]) =>
                `test.env.${key} is ${JSON.stringify(test.env?.[key])}, the pin sets ${JSON.stringify(value)}`,
        );

    for (const file of pin.setupFiles.filter((entry) => !setupFiles.includes(entry))) {
        findings.push(`test.setupFiles lacks the pin's check ${file}`);
    }

    return findings;
}

/**
 * Every package directory under `packages/`, keyed by its package name.
 *
 * @sideEffect Lists files through git and reads manifests.
 */
function workspaceDirectories(): ReadonlyMap<string, string> {
    const manifests = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', ':(glob)packages/**/package.json'],
        {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        },
    )
        .split('\n')
        .filter((path) => path !== '' && !path.includes('/node_modules/') && existsSync(join(REPO_ROOT, path)));

    return new Map(
        manifests.flatMap((path) => {
            const { name } = readManifest(dirname(path)) ?? {};

            return name === undefined ? [] : [[name, dirname(path)] as const];
        }),
    );
}

/** The string-valued entries of a parsed JSON object, or `undefined` when it is not one. Pure. */
function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }

    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}

/**
 * The fields of a parsed `package.json` this guard reads. Pure.
 *
 * @param json - The parsed manifest.
 * @returns Its name and dependency fields; a field of the wrong shape is absent.
 */
function manifestOf(json: unknown): Manifest {
    if (typeof json !== 'object' || json === null) {
        return {};
    }

    const field = (key: string): unknown => Object.entries(json).find(([name]) => name === key)?.[1];
    const name = field('name');

    return {
        ...(typeof name === 'string' ? { name } : {}),
        dependencies: stringRecord(field('dependencies')) ?? {},
        devDependencies: stringRecord(field('devDependencies')) ?? {},
        peerDependencies: stringRecord(field('peerDependencies')) ?? {},
    };
}

/**
 * A package's manifest, by repo-relative directory.
 *
 * @sideEffect Reads the working tree.
 */
const readManifest: ManifestReader = (directory) => {
    const path = join(REPO_ROOT, directory, 'package.json');

    return existsSync(path) ? manifestOf(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
};

/**
 * A tier config's resolved `test` block, parsed from what vite's loader returns.
 *
 * @param config - A repo-relative config path.
 * @returns Its `test` block.
 * @sideEffect Bundles and loads the config as vitest does, which runs its top level.
 */
async function resolvedTest(config: string): Promise<TierTest> {
    const path = join(REPO_ROOT, config);
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path, dirname(path), 'silent');
    const test: unknown = loaded?.config.test;

    if (typeof test !== 'object' || test === null) {
        return {};
    }

    const env: unknown = 'env' in test ? test.env : undefined;

    return {
        env: typeof env === 'object' && env !== null ? Object.fromEntries(Object.entries(env)) : undefined,
        setupFiles: 'setupFiles' in test ? test.setupFiles : undefined,
    };
}

describe('what a config must carry to apply a pin', () => {
    const pin: Pin = { env: { AWS_ENDPOINT_URL: 'http://a', AWS_PROFILE: '' }, setupFiles: ['/check.ts'] };
    const other: Pin = { env: { AWS_ENDPOINT_URL: 'http://b', AWS_PROFILE: '' }, setupFiles: ['/check.ts'] };

    it.each<[string, TierTest, number]>([
        ['the pin, whole', { env: { ...pin.env, OTHER: 'x' }, setupFiles: ['/check.ts', './setup.ts'] }, 0],
        ['the pin, its setup file given as a string', { env: { ...pin.env }, setupFiles: '/check.ts' }, 0],
        ['the env without the setup file', { env: { ...pin.env } }, 1],
        ['the setup file without the env', { setupFiles: ['/check.ts'] }, 2],
        [
            'an entry overridden after the spread',
            { env: { ...pin.env, AWS_ENDPOINT_URL: 'http://c' }, setupFiles: ['/check.ts'] },
            1,
        ],
        ['the other tier’s pin', { env: { ...other.env }, setupFiles: [...other.setupFiles] }, 1],
        ['no pin at all', {}, 3],
    ])('%s', (_case, test, findings) => {
        expect(pinFindings(test, pin)).toHaveLength(findings);
    });
});

describe('which packages can build an AWS client', () => {
    const manifests: Readonly<Record<string, Manifest>> = {
        direct: { dependencies: { '@aws-sdk/client-s3': '*' } },
        dev: { devDependencies: { '@aws-sdk/client-s3': '*' } },
        peer: { peerDependencies: { '@aws-sdk/client-s3': '*' } },
        viaRuntime: { dependencies: { '@x/client': '*' } },
        viaDev: { devDependencies: { '@x/client': '*' } },
        viaTypesOnly: { dependencies: { '@x/types': '*' } },
        cycle: { dependencies: { '@x/cycle': '*' } },
        none: { dependencies: { zod: '*' } },
        client: { dependencies: { '@aws-sdk/client-bedrock-runtime': '*' } },
        types: { devDependencies: { '@aws-sdk/client-bedrock-runtime': '*' } },
    };
    const workspaces = new Map([
        ['@x/client', 'client'],
        ['@x/types', 'types'],
        ['@x/cycle', 'cycle'],
    ]);

    it.each<[string, boolean]>([
        ['direct', true],
        ['dev', true],
        ['peer', true],
        ['viaRuntime', true],
        ['viaDev', true],
        ['viaTypesOnly', false],
        ['cycle', false],
        ['none', false],
    ])('%s', (directory, expected) => {
        expect(reachesAwsSdk(directory, (path) => manifests[path], workspaces)).toBe(expected);
    });
});

describe('the tier configs on the tree', () => {
    const workspaces = workspaceDirectories();
    const inScope = (fileName: string): readonly string[] =>
        tierConfigs(fileName).filter((config) => reachesAwsSdk(dirname(config), readManifest, workspaces));
    const local = inScope('vitest.e2e.config.ts');
    const integration = inScope('vitest.integration.config.ts');

    it('are discovered, so an empty scope cannot pass the assertions below', () => {
        expect(local).toEqual(
            expect.arrayContaining([
                'packages/services/food-service/vitest.e2e.config.ts',
                'packages/services/remote-search/vitest.e2e.config.ts',
            ]),
        );
        expect(integration).toEqual(
            expect.arrayContaining([
                'packages/services/food-service/vitest.integration.config.ts',
                'packages/tools/cookbook-import/vitest.integration.config.ts',
            ]),
        );
    });

    it.each(local)('⛔ %s applies the LOCAL e2e pin', async (config) => {
        expect(pinFindings(await resolvedTest(config), localE2eAwsPin(process.env))).toEqual([]);
    });

    it.each(integration)('⛔ %s applies the integration pin', async (config) => {
        expect(pinFindings(await resolvedTest(config), INTEGRATION_AWS_PIN)).toEqual([]);
    });
});
