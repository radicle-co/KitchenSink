/**
 * A FAILED FLOW KEEPS ITS DEBUG FOLDER; A PASSED FLOW KEEPS NOTHING.
 *
 * Maestro writes screenshots, the view hierarchy, the command trace and its log under `<HOME>/.maestro/tests/<time>/`,
 * one `<flow>` folder inside each time folder. A flow that fails once in a full run and passes alone (the iOS
 * `recipes/edit` and `recipes/ingredientVariantSearch` failures of 2026-11-08) leaves nothing to read once a lane's
 * folders are cleaned up. `maestro_keep_debug_folder` copies the failed flow's folder to the lane's evidence folder
 * while it still exists: from the runner's own HOME on a local lane, over rsync from the lane's HOME on the Mac when the
 * runner is driving the Mac through the shims.
 *
 * Each case runs the real functions with the Mac commands stubbed, so the guard checks what is copied and from where.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const scratch = mkdtempSync(path.join(tmpdir(), 'failureEvidence-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/** A fresh folder under the suite's temp dir. */
function fresh(name: string): string {
    const folder = path.join(scratch, name);
    mkdirSync(folder, { recursive: true });

    return folder;
}

/** Write a file, making its folders. */
function put(file: string, text = 'x'): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text, 'utf8');
}

/** Source the runner and run `body`, with `env` set. */
function bash(body: string, env: Readonly<Record<string, string>>) {
    return spawnSync('bash', ['-c', `. '${SCRIPT}'\n${body}`], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', ...env },
    });
}

describe('maestro_evidence_dir', () => {
    it('answers nothing when the run did not ask for evidence', () => {
        const result = bash('maestro_evidence_dir recipes/edit', {});

        expect(result.stdout).toBe('');
        expect(result.status).toBe(0);
    });

    it('names, and makes, one folder per failed flow under the evidence folder, with the path flattened', () => {
        const evidence = fresh('named');
        const result = bash('maestro_evidence_dir recipes/edit', { MAESTRO_EVIDENCE_DIR: evidence });

        expect(result.stdout.trim()).toBe(path.join(evidence, 'recipes__edit'));
        expect(existsSync(path.join(evidence, 'recipes__edit'))).toBe(true);
    });
});

describe('maestro_keep_debug_folder on a local lane', () => {
    it("copies the time folder that holds THIS flow's folder, not the newest folder of another flow", () => {
        const home = fresh('homeLocal');
        const tests = path.join(home, '.maestro/tests');
        put(path.join(tests, '2026-11-08_000001/edit/screenshots/old.png'));
        put(path.join(tests, '2026-11-08_000002/edit/screenshots/screenshot-failed.png'));
        put(path.join(tests, '2026-11-08_000002/edit/screen-hierarchy/hierarchy.json'));
        put(path.join(tests, '2026-11-08_000002/maestro.log'));
        // Another lane's flow, started later, in the same shared folder.
        put(path.join(tests, '2026-11-08_000003/other/screenshots/other.png'));
        const dest = fresh('destLocal');

        const result = bash(`maestro_keep_debug_folder recipes/edit '${dest}'`, { HOME: home });

        expect(result.status).toBe(0);
        expect(readdirSync(path.join(dest, 'debug/edit/screenshots'))).toEqual(['screenshot-failed.png']);
        expect(existsSync(path.join(dest, 'debug/edit/screen-hierarchy/hierarchy.json'))).toBe(true);
        expect(existsSync(path.join(dest, 'debug/maestro.log'))).toBe(true);
        expect(existsSync(path.join(dest, 'debug/other'))).toBe(false);
    });

    it('says so, and still succeeds, when no folder holds the flow', () => {
        const home = fresh('homeNone');
        put(path.join(home, '.maestro/tests/2026-11-08_000001/other/x'));
        const dest = fresh('destNone');

        const result = bash(`maestro_keep_debug_folder recipes/edit '${dest}'`, { HOME: home });

        expect(result.status).toBe(0);
        expect(readFileSync(path.join(dest, 'noDebugFolder.txt'), 'utf8')).toContain('recipes/edit');
    });

    it('refuses a flow name that would leave the folder it was given', () => {
        const dest = fresh('destEscape');
        const result = bash(`maestro_keep_debug_folder '../../etc' '${dest}'`, { HOME: fresh('homeEscape') });

        expect(result.status).not.toBe(0);
    });
});

describe('maestro_keep_debug_folder on a Mac lane', () => {
    it("fetches the time folder from the lane's HOME on the Mac over the run's ssh config", () => {
        const calls = path.join(fresh('macCalls'), 'calls.log');
        const dest = fresh('destMac');
        const stubs =
            `ssh() { echo "ssh $*" >> '${calls}'; echo 2026-11-08_000002; }\n` +
            `rsync() { echo "rsync $*" >> '${calls}'; }\n`;

        const result = bash(`${stubs}maestro_keep_debug_folder recipes/edit '${dest}'`, {
            HOME: fresh('homeMac'),
            KS_MAC_HOST: 'me@mac',
            KS_MAC_SSH_CONFIG: '/state/ssh.conf',
            KS_MAC_LANE_HOME: '/Users/me/ksIos/lanes/lane2',
        });

        expect(result.status).toBe(0);
        const lines = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
        expect(lines[0]).toMatch(/^ssh -F \/state\/ssh\.conf me@mac /u);
        expect(lines[0]).toContain('/Users/me/ksIos/lanes/lane2/.maestro/tests');
        expect(lines[1]).toBe(
            `rsync -a -e ssh -F /state/ssh.conf me@mac:/Users/me/ksIos/lanes/lane2/.maestro/tests/2026-11-08_000002/ ${dest}/debug/`,
        );
    });
});
