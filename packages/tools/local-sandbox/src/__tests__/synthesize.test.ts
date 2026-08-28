/**
 * Repo-wide guard: the local sandbox synthesises the CDK rather than reading whatever is on disk.
 *
 * ## Why "some templates were produced" is not the same as "the synth succeeded"
 *
 * Real behaviour, measured against `packages/infra/global` on 2026-08-27: `cdk synth --all` exits reporting
 * "Synthesis finished with errors" — a Route 53 context lookup for the placeholder domain finds no hosted
 * zone — and STILL writes all seven templates. Treating that exit code as fatal would discard a complete
 * and usable inventory; treating it as success would hide a synth that genuinely produced nothing.
 *
 * So the outcome carries both facts, and the caller decides. What must never happen is the third option the
 * old implementation took: quietly proceeding with a partial inventory and printing a confident answer.
 */
import { describe, expect, it } from 'vitest';

import { synthesizeAll, type SynthRunner } from '../synthesize.js';
import type { CdkApp } from '../discoverApps.js';

const app = (name: string): CdkApp => ({
    packageName: name,
    packageDir: `packages/${name}`,
    script: 'synth',
    appCommand: 'npx tsx bin/app.ts',
});

/**
 * An app whose `--app` could not be read.
 *
 * ⚠️ A separate factory rather than `app(name, undefined)`. Passing `undefined` to a parameter with a
 * default triggers the DEFAULT — the first draft of this file did exactly that and asserted the
 * unreadable-command path while actually exercising the happy one.
 */
const unreadableApp = (name: string): CdkApp => ({ ...app(name), appCommand: undefined });

/** A runner that reports what each app produced, without running anything. */
const runner =
    (byApp: Record<string, { code: number; templates: string[]; stderr?: string }>): SynthRunner =>
    async (request) => {
        const result = byApp[request.app.packageName] ?? { code: 0, templates: [] };

        return { exitCode: result.code, templates: result.templates, stderr: result.stderr ?? '' };
    };

describe('synthesizeAll', () => {
    it('synthesises every app and reports the templates each produced', async () => {
        const outcomes = await synthesizeAll(
            [app('a'), app('b')],
            runner({ a: { code: 0, templates: ['A.template.json'] }, b: { code: 0, templates: ['B.template.json'] } }),
            { outRoot: '/tmp/out' },
        );

        expect(outcomes.map((o) => o.app.packageName)).toEqual(['a', 'b']);
        expect(outcomes.every((o) => o.usable)).toBe(true);
    });

    it('treats a non-zero exit that still produced templates as USABLE but degraded', async () => {
        // The real global-app case: a context lookup fails, every template is still written.
        const [outcome] = await synthesizeAll(
            [app('global')],
            runner({ global: { code: 1, templates: ['G.template.json'], stderr: 'Found zones: []' } }),
            { outRoot: '/tmp/out' },
        );

        expect(outcome?.usable).toBe(true);
        expect(outcome?.clean).toBe(false);
        expect(outcome?.stderr).toContain('Found zones');
    });

    it('is NOT usable when the synth produced no templates', async () => {
        const [outcome] = await synthesizeAll(
            [app('broken')],
            runner({ broken: { code: 1, templates: [], stderr: 'boom' } }),
            { outRoot: '/tmp/out' },
        );

        expect(outcome?.usable).toBe(false);
        expect(outcome?.clean).toBe(false);
    });

    /**
     * ⚠️ REVISED. An earlier draft REFUSED to synthesise an app whose `--app` could not be parsed. That was
     * wrong once synthesis started invoking the package's own npm script: the script exists by construction,
     * so the parsed command is diagnostic detail, and refusing on it would drop a synthesisable app out of
     * the inventory — the very failure this package exists to prevent.
     */
    it('still synthesises an app whose --app could not be parsed, because it runs the SCRIPT', async () => {
        const [outcome] = await synthesizeAll(
            [unreadableApp('mystery')],
            runner({ mystery: { code: 0, templates: ['M.template.json'] } }),
            { outRoot: '/tmp/out' },
        );

        expect(outcome?.usable).toBe(true);
    });

    it('gives each app its own output directory, so one app cannot read another as its own', async () => {
        const seen: string[] = [];
        await synthesizeAll(
            [app('a'), app('b')],
            async (request) => {
                seen.push(request.outDir);

                return { exitCode: 0, templates: [], stderr: '' };
            },
            { outRoot: '/tmp/out' },
        );

        expect(new Set(seen).size).toBe(2);
        expect(seen.every((dir) => dir.startsWith('/tmp/out'))).toBe(true);
    });

    it('runs each synth in its own package directory', async () => {
        const seen: string[] = [];
        await synthesizeAll(
            [app('a')],
            async (request) => {
                seen.push(request.cwd);

                return { exitCode: 0, templates: [], stderr: '' };
            },
            { outRoot: '/tmp/out' },
        );

        expect(seen).toEqual(['packages/a']);
    });
});
