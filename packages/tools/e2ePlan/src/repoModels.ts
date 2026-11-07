/**
 * Builds the two tier models from the real repository: the web app's Playwright specs and the mobile app's Maestro
 * flows, each with its import graph, its screens and its coverage registry.
 *
 * This is the one module that knows where things live. Everything it feeds is pure and tested on its own.
 */
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { changedRows } from './changedRows.js';
import { checkCoverage, parseCoverage, type CoverageTable } from './coverageTable.js';
import { buildImportGraph, type GraphProfile } from './dependencyGraph.js';
import { maestroFlowGraph } from './maestroFlows.js';
import { mobileRegistry } from './mobileScreens.js';
import type { Models, TierModel } from './planChange.js';
import { reach, type Reached } from './reachability.js';
import { webRegistry } from './webRoutes.js';
import { isTestSupportCandidate, testingDirs } from './testSupport.js';
import { closureOf, readWorkspaces } from './workspaces.js';

const WEB = 'packages/apps/commise/web';
const MOBILE = 'packages/apps/commise/mobile';

export const SPEC_TABLE = `${WEB}/tests/e2e/specScreens.tsv`;
export const FLOW_TABLE = `${MOBILE}/tests/e2e/maestroFlowScreens.tsv`;

/** Every Maestro flow starts on, and signs in through, Home. */
export const MOBILE_PASS_THROUGH = ['HomeScreen'] as const;

export const WEB_PROFILE: GraphProfile = {
    name: 'web',
    cruise: [`${WEB}/src`, `${WEB}/tests/e2e`],
    tsConfig: `${WEB}/tsconfig.json`,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
};

export const MOBILE_PROFILE: GraphProfile = {
    name: 'mobile',
    cruise: [`${MOBILE}/src`, `${MOBILE}/App.tsx`],
    tsConfig: `${MOBILE}/tsconfig.json`,
    extensions: ['.native.tsx', '.native.ts', '.native.js', '.tsx', '.ts', '.js', '.jsx', '.json', '.mjs'],
};

const merge = (parts: readonly Reached[]): Reached | undefined =>
    parts.length === 0
        ? undefined
        : {
              screens: new Set(parts.flatMap((part) => [...part.screens])),
              tests: new Set(parts.flatMap((part) => [...part.tests])),
              roots: [...new Set(parts.flatMap((part) => part.roots))].sort(),
          };

const read = (repo: string, path: string): string => readFileSync(join(repo, path), 'utf8');

/** The table as it was at the merge base, or undefined when the file did not exist then. */
function tableAt(repo: string, mergeBase: string | undefined, path: string): CoverageTable | undefined {
    if (mergeBase === undefined) {
        return undefined;
    }

    try {
        const text = execFileSync('git', ['show', `${mergeBase}:${path}`], {
            cwd: repo,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });

        return parseCoverage(text, `${path}@${mergeBase.slice(0, 7)}`);
    } catch {
        return undefined;
    }
}

/** `Button.native.tsx`: a leaf only the native bundler picks. */
const NATIVE_LEAF = /\.native\.([cm]?[jt]sx?)$/u;

const noRoots: ReadonlySet<string> = new Set();

async function webModel(repo: string, mergeBase: string | undefined): Promise<TierModel> {
    const graph = await buildImportGraph(repo, WEB_PROFILE);
    const appFiles = globSync(`${WEB}/src/app/**/*`, { cwd: repo });
    const topLevel = globSync(`${WEB}/src/*.{ts,tsx}`, { cwd: repo });
    const registry = webRegistry({ appDir: `${WEB}/src/app`, extraRoots: topLevel, files: appFiles.sort() });
    const specs = globSync(`${WEB}/tests/e2e/**/*.spec.ts`, { cwd: repo }).sort();
    const specId = (file: string): string => file.slice(`${WEB}/tests/e2e/`.length);
    const table = parseCoverage(read(repo, SPEC_TABLE), SPEC_TABLE);
    const terminals = { ...registry.terminals, tests: new Map(specs.map((file) => [file, specId(file)] as const)) };
    const edited = changedRows(tableAt(repo, mergeBase, SPEC_TABLE), table);

    return {
        name: 'web',
        screens: registry.screens,
        tests: specs.map(specId),
        coverage: table,
        shippingImportersOf: (file) =>
            graph.importersOf(file).filter((importer) => !importer.startsWith(`${WEB}/tests/`)),
        belongsToOtherPlatform: (file) =>
            file.startsWith(`${MOBILE}/`) || (NATIVE_LEAF.test(file) && graph.has(file.replace(NATIVE_LEAF, '.$1'))),
        reachFile: (file) =>
            file === SPEC_TABLE
                ? { screens: new Set(), tests: new Set(edited), roots: [] }
                : graph.has(file)
                  ? reach(file, graph.importersOf, terminals)
                  : undefined,
        problems: [
            ...graph.problems,
            ...checkCoverage({ tests: specs.map(specId), screens: registry.screens, table }).map(
                (problem) => `${SPEC_TABLE}: ${problem}`,
            ),
        ],
    };
}

/** The flows a run starts, from the runner's own plan (one flow per line, the spine as `spine:<flow>`), so the list has one source. */
function plannedFlows(repo: string): readonly string[] {
    const output = execFileSync('bash', [`${MOBILE}/tests/e2e/runMaestroFlows.sh`, 'plan'], {
        cwd: repo,
        encoding: 'utf8',
    });

    return output
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.replace(/^spine:/u, ''));
}

async function mobileModel(repo: string, mergeBase: string | undefined): Promise<TierModel> {
    const graph = await buildImportGraph(repo, MOBILE_PROFILE);
    const registry = mobileRegistry({
        screensDir: `${MOBILE}/src/screens`,
        registrars: [`${MOBILE}/src/navigation/`, `${MOBILE}/src/components/AuthGate.tsx`],
        roots: [`${MOBILE}/App.tsx`, `${MOBILE}/app.config.ts`],
        files: graph.files.filter((file) => file.startsWith(`${MOBILE}/`)),
        importersOf: graph.importersOf,
    });
    const flowFiles = globSync(`${MOBILE}/.maestro/**/*`, { cwd: repo }).sort();
    const flows = maestroFlowGraph({
        dir: `${MOBILE}/.maestro`,
        files: flowFiles,
        read: (path) => read(repo, path),
        topLevel: plannedFlows(repo),
    });
    const table = parseCoverage(read(repo, FLOW_TABLE), FLOW_TABLE);
    const tests = [...flows.tests.values()];
    const idOf = (file: string): string => file.slice(`${MOBILE}/.maestro/`.length).replace(/\.ya?ml$/u, '');
    // A sub-flow (the sign-in flows) may carry a row: its screens belong to every flow that runs it, through the flow
    // graph, so no flow names a screen a sub-flow already stands for.
    const subflows = flowFiles.filter((file) => /\.ya?ml$/u.test(file) && !flows.tests.has(file)).map(idOf);
    const flowTerminals = { screenEntries: new Map(), roots: noRoots, tests: flows.tests };
    const edited = changedRows(tableAt(repo, mergeBase, FLOW_TABLE), table).flatMap((id) =>
        tests.includes(id) ? [id] : [...reach(`${MOBILE}/.maestro/${id}.yaml`, flows.importersOf, flowTerminals).tests],
    );
    const coverage = new Map(
        [...flows.tests].map(([file, id]) => {
            const screens = new Set<string>([...(table.get(id) ?? []), ...MOBILE_PASS_THROUGH]);

            for (const sub of flows.runsOf(file)) {
                (table.get(idOf(sub)) ?? new Set<string>()).forEach((screen) => screens.add(screen));
            }

            return [id, screens] as const;
        }),
    );

    return {
        name: 'mobile',
        screens: registry.screens,
        tests,
        coverage,
        shippingImportersOf: graph.importersOf,
        belongsToOtherPlatform: (file) =>
            file.startsWith(`${WEB}/`) ||
            (!NATIVE_LEAF.test(file) &&
                /\.([cm]?[jt]sx?)$/u.test(file) &&
                graph.has(file.replace(/\.([cm]?[jt]sx?)$/u, '.native.$1'))),
        reachFile: (file) => {
            if (file === FLOW_TABLE) {
                return { screens: new Set(), tests: new Set(edited), roots: [] };
            }

            return merge([
                ...(graph.has(file)
                    ? [reach(file, graph.importersOf, { ...registry.terminals, tests: new Map() })]
                    : []),
                ...(flows.has(file) ? [reach(file, flows.importersOf, flowTerminals)] : []),
            ]);
        },
        problems: [
            ...graph.problems,
            ...flows.problems,
            ...checkCoverage({ tests, optional: subflows, screens: registry.screens, table }).map(
                (problem) => `${FLOW_TABLE}: ${problem}`,
            ),
        ],
    };
}

/**
 * Builds both tier models.
 *
 * @sideEffect Reads the repository, runs dependency-cruiser, and runs the Maestro runner's pure `plan` subcommand.
 * @param repo - The repository root.
 * @param mergeBase - The commit changes are measured from; lets a registry edit select just the rows it changed.
 * @returns The models.
 * @throws When a registry is missing or malformed: the caller falls back to the full suite.
 */
export async function loadRepoModels(repo: string, mergeBase?: string): Promise<Models> {
    const [web, mobile] = await Promise.all([webModel(repo, mergeBase), mobileModel(repo, mergeBase)]);

    const packages = readWorkspaces(repo);
    const testing = testingDirs(packages);
    const serviceDirs = [
        ...closureOf(packages, ['packages/services/*', 'packages/tools/e2e-fixtures', 'packages/tools/e2e-seed']),
    ].sort();

    return {
        web,
        mobile,
        serviceDirs,
        isTestSupport: (file) =>
            isTestSupportCandidate(file, testing) &&
            web.shippingImportersOf(file).length === 0 &&
            mobile.shippingImportersOf(file).length === 0,
    };
}
