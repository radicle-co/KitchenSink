// @vitest-environment node
/**
 * Every NestJS service must be startable by its own `dev` script.
 *
 * ## The defect this was written for
 *
 * On 2026-08-22 not one of the three NestJS services could be started locally, and each failed for a
 * DIFFERENT reason — which is why no single person ever noticed it was a class of failure rather than a
 * one-off:
 *
 * | service        | `dev` script            | what happened                                                  |
 * | -------------- | ----------------------- | -------------------------------------------------------------- |
 * | identity       | `nest start --watch`    | `ERR_MODULE_NOT_FOUND` on `packages/schemas/identity/src/…`      |
 * | food-service   | `nest start --watch`    | the same, on `packages/schemas/food/src/…`                       |
 * | recipe-service | `tsx watch src/main.ts` | `UndefinedDependencyException … argument at index [1]`           |
 *
 * Both failures come from ONE property of this monorepo: every shared package exports raw TypeScript
 * (`"exports": { ".": "./src/index.ts" }`, ADR-0014 — the `dist` mapping exists only in `prod.package.json`,
 * for the image). So the local runner has to transpile TypeScript **process-wide**, not just this package's.
 *
 * - `nest start` compiles the service to `dist/` and then runs it under PLAIN `node`, which cannot load a
 *   dependency's `.ts` at all. It never reaches Nest.
 * - `tsx` does transpile everything, but it is esbuild, and **esbuild does not implement
 *   `emitDecoratorMetadata`**. Measured: `Reflect.getMetadata('design:paramtypes', RecipesService)` is
 *   `undefined` under tsx and a 7-entry array under Vite's transform. Nest resolves any constructor
 *   parameter WITHOUT an explicit `@Inject()` by that reflected type, so every one of them becomes
 *   `undefined` — and because the surviving `@Inject` tokens sat at indices 0 and 2–5, Nest reported a
 *   six-long dependency list with a hole at index 1 for a constructor that has seven parameters. That
 *   mismatch is what made the failure read as a phantom rather than as a missing transform.
 *
 * ⚠️ Neither failure can be caught by the test suites. Vitest boots the real `AppModule` in every service's
 * e2e tier and it PASSES — because vitest transforms through Vite (rolldown/oxc), which honours
 * `emitDecoratorMetadata` and transpiles the workspace packages. The e2e tier proves the module graph is
 * sound; it says nothing about the command a developer actually types. Hence this gate.
 *
 * ## Why the probe EXECUTES the runners instead of trusting a list
 *
 * A gate that only checked `dev` against an approved-runner list would be asserting a belief. {@link probe}
 * runs each runner against a generated fixture that reproduces both requirements at once — it imports a
 * raw-TS workspace package AND reads back `design:paramtypes` — so the list cannot drift into fiction.
 *
 * The `tsx` case below is a deliberate NEGATIVE CONTROL, and it is the reason the positive case means
 * anything: without it, a probe that silently stopped measuring would report every runner as fine. ⛔ If it
 * ever fails, esbuild has GAINED decorator-metadata support — re-measure and re-decide, do not delete the
 * assertion.
 *
 * DESIGN PATTERN: Specification module over pure predicates ({@link devRunner}, {@link nonConformingServices})
 * fired at deliberately-violating fakes, plus an impure adapter ({@link probe}) that measures the mechanism
 * the predicates encode.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SERVICES_ROOT, repoRoot } from './serviceSources.js';

/**
 * Runners whose transform satisfies BOTH requirements, each proven by {@link probe} below.
 *
 * Kept deliberately short. A runner earns a place here by passing the probe, not by looking plausible.
 */
const APPROVED_RUNNERS: readonly string[] = ['vite-node'];

/** A runner known to FAIL the probe, kept as the negative control that gives the positive case meaning. */
const METADATA_DROPPING_RUNNER = 'tsx';

/** A NestJS service as this gate sees it. */
interface NestService {
    /** Directory name under `packages/services/`. */
    readonly name: string;
    /** Its `dev` script, or `undefined` when it declares none. */
    readonly devScript: string | undefined;
}

/** A service whose `dev` script cannot start it. */
interface NonConforming {
    /** Directory name under `packages/services/`. */
    readonly service: string;
    /** The offending script, verbatim. */
    readonly devScript: string | undefined;
    /** The runner extracted from it. */
    readonly runner: string | undefined;
}

/**
 * The runner a shell command actually invokes: leading `KEY=value` assignments stripped and `npx` unwrapped.
 *
 * @param command - A `package.json` script body, or `undefined`.
 * @returns The runner's bare name, or `undefined` when the command names none. Pure.
 */
export function devRunner(command: string | undefined): string | undefined {
    const words = (command ?? '')
        .trim()
        .split(/\s+/u)
        .filter((word) => word.length > 0);
    // A LEADING `NODE_ENV=development` is env, not the runner — and it is exactly how the broken recipe
    // script was written, so a gate reading the first word alone would have reported `NODE_ENV=development`.
    // Only the leading run is stripped: an `=` later in the line belongs to a flag, not to the environment.
    let index = 0;

    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? '')) {
        index += 1;
    }

    const first = words[index];

    return first === 'npx' ? words[index + 1] : first;
}

/**
 * Every NestJS service in the tree, DISCOVERED rather than enumerated so a service that lands tomorrow is
 * covered the day its manifest does.
 *
 * @returns One entry per `packages/services/*` whose manifest depends on `@nestjs/core`.
 * @sideEffect Reads the services tree.
 */
function discoverNestServices(): readonly NestService[] {
    const services: NestService[] = [];
    const servicesDir = path.join(repoRoot, SERVICES_ROOT);

    for (const entry of readdirSync(servicesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const manifestPath = path.join(servicesDir, entry.name, 'package.json');

        if (!existsSync(manifestPath)) {
            continue;
        }

        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
            dependencies?: Record<string, string>;
            scripts?: Record<string, string>;
        };

        if (manifest.dependencies?.['@nestjs/core'] !== undefined) {
            services.push({ name: entry.name, devScript: manifest.scripts?.['dev'] });
        }
    }

    return services;
}

/**
 * The services whose `dev` script names a runner that cannot start them.
 *
 * @param services - The discovered NestJS services.
 * @returns One entry per non-conforming service, sorted by name. Pure.
 */
export function nonConformingServices(services: readonly NestService[]): readonly NonConforming[] {
    return services
        .filter((service) => {
            const runner = devRunner(service.devScript);

            return runner === undefined || !APPROVED_RUNNERS.includes(runner);
        })
        .map((service) => ({
            service: service.name,
            devScript: service.devScript,
            runner: devRunner(service.devScript),
        }))
        .sort((a, b) => a.service.localeCompare(b.service));
}

/** What {@link probe} measured about a runner. */
interface ProbeResult {
    /** Whether the probe process exited 0 and reported something parseable. */
    readonly ran: boolean;
    /** Reflected constructor parameter count, or `undefined` when the transform emitted no metadata. */
    readonly paramTypes: number | undefined;
    /** Whether the raw-TypeScript workspace import resolved to a value. */
    readonly resolvedWorkspaceImport: boolean;
}

/** The committed fixture each runner is pointed at — see its docstring for what it measures and why. */
const PROBE_ENTRY = path.join(repoRoot, 'packages/infra/global/__tests__/__fixtures__/devRunnerProbe/probe.ts');

/**
 * Run one runner against {@link PROBE_ENTRY} and read back what its transform produced.
 *
 * Resolves the runner from `node_modules/.bin` rather than shelling through `npx`, so a runner that is not
 * installed fails as a missing binary here instead of being silently fetched from the network mid-test.
 *
 * @param runner - The runner's bare name.
 * @returns What the probe reported; `ran: false` when the runner could not execute it at all.
 * @sideEffect Spawns a child process.
 */
function probe(runner: string): ProbeResult {
    try {
        const stdout = execFileSync(path.join(repoRoot, 'node_modules', '.bin', runner), [PROBE_ENTRY], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
        });
        const reported = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Partial<ProbeResult>;

        return {
            ran: reported.resolvedWorkspaceImport !== undefined,
            paramTypes: reported.paramTypes,
            resolvedWorkspaceImport: reported.resolvedWorkspaceImport === true,
        };
    } catch {
        return { ran: false, paramTypes: undefined, resolvedWorkspaceImport: false };
    }
}

describe('service dev runner', () => {
    it('starts every NestJS service from its own dev script', () => {
        const services = discoverNestServices();

        expect(services.length, 'no NestJS service discovered — the gate has stopped discovering').toBeGreaterThan(0);

        expect(
            nonConformingServices(services),
            'This monorepo exports shared packages as raw TypeScript, so a service can only be started ' +
                'locally by a runner that transpiles TypeScript process-wide AND honours ' +
                '`emitDecoratorMetadata`. `nest start` fails the first (it runs plain node over dist); `tsx` ' +
                'fails the second (esbuild drops the metadata, so Nest sees every type-injected constructor ' +
                'parameter as undefined).',
        ).toEqual([]);
    });

    it.each(APPROVED_RUNNERS)('%s transpiles workspace TypeScript and emits decorator metadata', (runner) => {
        const result = probe(runner);

        expect(result.ran, `${runner} did not run the probe at all`).toBe(true);
        expect(result.resolvedWorkspaceImport, `${runner} could not import a raw-TypeScript workspace package`).toBe(
            true,
        );
        expect(result.paramTypes, `${runner} emitted no design:paramtypes`).toBe(1);
    });

    it('⛔ NEGATIVE CONTROL: the metadata-dropping runner still fails the probe', () => {
        // Without this the positive case above proves nothing: a probe that quietly stopped measuring would
        // report every runner as fine. If THIS goes red, esbuild gained `emitDecoratorMetadata` — re-measure
        // and re-decide which runners are approved. Do not delete the assertion.
        const result = probe(METADATA_DROPPING_RUNNER);

        // It must RUN and resolve the workspace import — otherwise "no metadata" would be indistinguishable
        // from "the probe never executed", and the control would pass for the wrong reason.
        expect(result.ran, `${METADATA_DROPPING_RUNNER} did not run the probe — the control proves nothing`).toBe(true);
        expect(result.resolvedWorkspaceImport).toBe(true);
        expect(
            result.paramTypes,
            `${METADATA_DROPPING_RUNNER} now emits decorator metadata — re-measure which runners are approved`,
        ).toBeUndefined();
    });

    it('reads the runner past leading env assignments and npx', () => {
        expect(devRunner('NODE_ENV=development tsx watch src/main.ts')).toBe('tsx');
        expect(devRunner('npx vite-node --watch src/main.ts')).toBe('vite-node');
        expect(devRunner('nest start --watch')).toBe('nest');
        expect(devRunner(undefined)).toBeUndefined();
    });

    it('reports a non-conforming service and ignores a conforming one', () => {
        expect(
            nonConformingServices([
                { name: 'good', devScript: 'NODE_ENV=development vite-node --watch src/main.ts' },
                { name: 'bad', devScript: 'tsx watch src/main.ts' },
                { name: 'none', devScript: undefined },
            ]),
        ).toEqual([
            { service: 'bad', devScript: 'tsx watch src/main.ts', runner: 'tsx' },
            { service: 'none', devScript: undefined, runner: undefined },
        ]);
    });
});
