/**
 * @module __tests__/testApp — a CDK `App` whose cloud assembly is removed when the test file finishes.
 *
 * ⛔ WHY THIS EXISTS. `new App()` with no `outdir` prop synthesizes into `mkdtemp(cdk.out*)` under the OS
 * temp directory and NEVER removes it — one directory per App, and ~0.9 MB each once anything synthesizes
 * into it. One run of this package's unit tier built with `new App()` leaves **205 such directories and
 * 186 MB** (measured 2026-09-08); across the repository the accumulation was measured at 64,544 directories
 * on 2026-08-27. `outdir` is an ordinary documented constructor prop, so this leak is OURS to close.
 *
 * ⛔ NOT `CDK_OUTDIR`. `App`'s constructor reads `props.autoSynth ?? (OUTDIR_ENV in process.env)`, so merely
 * SETTING that variable registers a `beforeExit` synth on every App in the process — a behaviour change to
 * every infra suite, bought to solve a disk problem. Passing the prop changes nothing but where the assembly
 * lands, and callers that already pass their own `outdir` keep it.
 *
 * DESIGN PATTERN: Factory Method — one construction point for the App this package's suites synthesize, so
 * the assembly's lifetime is decided once rather than at 18 call sites.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, type AppProps } from 'aws-cdk-lib';
import { afterAll } from 'vitest';

/** The cloud-assembly directories {@link testApp} created for the importing file. */
const synthOutputs: string[] = [];

// Registered at IMPORT time, so it attaches to the suite of whichever test file pulled this helper in —
// each of which gets its own module instance under vitest's per-file isolation. A hook here rather than a
// line at each call site is what makes a FAILING or throwing test clean up too.
afterAll(() => {
    for (const directory of synthOutputs) {
        rmSync(directory, { recursive: true, force: true });
    }

    synthOutputs.length = 0;
});

/**
 * A CDK `App` whose synth output lands somewhere this test file will remove.
 *
 * @param props - Everything else the App needs. An `outdir` the caller supplies is respected and left alone.
 * @returns The App.
 * @sideEffect Creates a directory under the OS temp directory and registers it for removal.
 */
export function testApp(props: AppProps = {}): App {
    if (props.outdir !== undefined) {
        return new App(props);
    }

    const outdir = mkdtempSync(join(tmpdir(), 'cdk-synth-'));

    synthOutputs.push(outdir);

    return new App({ ...props, outdir });
}
