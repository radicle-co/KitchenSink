/**
 * `@types/node`'s major MUST equal the `engines.node` major — asserted by DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. On 2026-08-27 a dependency sweep bumped `@types/node` to `^26.4.0` in all 16
 * packages that declare it, while every one of the 44 workspaces pins `engines.node: "24.x"` and CI, the
 * Lambdas and the Fargate images all run Node 24. Types two majors AHEAD of the runtime do not fail loudly —
 * they fail by ACCEPTING code that cannot run. Measured on this tree, against `tsc` 6.0.3:
 *
 *     import * as v8 from 'node:v8';
 *     export const h = v8.startHeapProfile();
 *
 * compiles CLEAN under `@types/node@26.4.0`, and on Node 24.16.0 `v8.startHeapProfile` is `undefined` — a
 * TypeError at runtime, past a green typecheck. Under `@types/node@24.13.3` the same line is correctly
 * rejected (`TS2551`). `node:quic` and `node:ffi` are typed by 26 and answer `ERR_UNKNOWN_BUILTIN_MODULE`
 * on 24, so the hazard is whole modules, not one stray function.
 *
 * ⛔ IT ENUMERATES NOTHING. Both sides come from the filesystem: every `package.json` that declares
 * `@types/node`, and every one that declares `engines.node`. A package added tomorrow is covered the day it
 * lands. `natEgressConsumers.test.ts` records why a hand-written list would be worse than nothing —
 * _"a copy of a list cannot detect that the list is incomplete."_
 *
 * ⚠️ The check is on the MAJOR only. Patch and minor drift inside the runtime's own major is fine and
 * expected; it is the major that decides which APIs exist.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

interface Manifest {
    readonly file: string;
    readonly typesRange?: string | undefined;
    readonly enginesRange?: string | undefined;
}

/** Every workspace manifest, found rather than listed. */
const manifests = (): readonly Manifest[] =>
    globSync(['package.json', 'packages/**/package.json'], {
        cwd: REPO_ROOT,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    })
        .sort()
        .map((file) => {
            const parsed: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
            const manifest = parsed as {
                devDependencies?: Record<string, string>;
                dependencies?: Record<string, string>;
                engines?: Record<string, string>;
            };

            return {
                file,
                typesRange: manifest.devDependencies?.['@types/node'] ?? manifest.dependencies?.['@types/node'],
                enginesRange: manifest.engines?.['node'],
            };
        });

/** The leading integer of a range such as `^26.4.0` or `24.x`. */
const majorOf = (range: string): string => {
    const match = /(\d+)/.exec(range);

    if (match === null) {
        throw new Error(`unparseable version range: ${range}`);
    }

    return match[1] as string;
};

describe('@types/node tracks the runtime major', () => {
    it('discovers both sides, and finds enough of each to be a real check', () => {
        // ⛔ Anti-vacuity. A glob that matched nothing would make every assertion below pass silently.
        const all = manifests();
        expect(all.filter((m) => m.typesRange !== undefined).length).toBeGreaterThan(10);
        expect(all.filter((m) => m.enginesRange !== undefined).length).toBeGreaterThan(30);
    });

    it('pins ONE runtime major across the whole workspace', () => {
        const majors = [
            ...new Set(
                manifests()
                    .filter((m) => m.enginesRange !== undefined)
                    .map((m) => majorOf(m.enginesRange as string)),
            ),
        ];
        expect(majors).toHaveLength(1);
    });

    it('declares no @types/node ahead of (or behind) the runtime it will run on', () => {
        const all = manifests();
        const runtimeMajor = majorOf(
            all.find((m) => m.file === 'package.json' && m.enginesRange !== undefined)?.enginesRange as string,
        );

        const mismatched = all
            .filter((m) => m.typesRange !== undefined)
            .filter((m) => majorOf(m.typesRange as string) !== runtimeMajor)
            .map((m) => `${m.file}: @types/node ${m.typesRange as string} vs node ${runtimeMajor}.x`);

        expect(mismatched).toEqual([]);
    });
});
