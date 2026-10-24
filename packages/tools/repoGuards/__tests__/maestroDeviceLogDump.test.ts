/**
 * A FAILED ANDROID FLOW'S LOG DUMP READS THE APP'S LINES, NOT MAESTRO'S OWN.
 *
 * `maestro_dump_device_log` takes the last 4000 logcat lines and greps them for the app and crash tags. Maestro's
 * on-device driver logs a "Skipping invisible child" line for every hidden node of every hierarchy read, so those 4000
 * lines covered only the last seconds of the flow: local run 2026-10-20, `sessionHandoff` on Android shard 2 sat on a
 * blank screen for 30 s, and the dump showed only the clear-data lines from before the launch, with no
 * `ReactNativeJS` line at all. The emulator was gone by the time anyone looked, so the cause was lost.
 *
 * The dump therefore silences the `Maestro` tag in logcat's own filter, so the window it reads is the app's. Asserted by
 * running the function with `adb` stubbed, so the guard checks the command, not its spelling.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const scratch = mkdtempSync(path.join(tmpdir(), 'deviceLogDump-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/**
 * Source the runner with `adb` stubbed, dump the log for one flow, and return the `adb` calls and the output.
 *
 * @sideEffect Spawns bash and writes a log under the suite's temp dir.
 */
function dump(): { readonly calls: readonly string[]; readonly output: string } {
    const log = path.join(scratch, 'calls.log');
    const stub =
        `adb() { echo "adb $*" >> '${log}'; ` +
        `echo 'I Maestro : Skipping invisible child'; echo 'I ReactNativeJS: app line'; }`;
    const result = spawnSync(
        'bash',
        ['-c', `${stub}\n. '${SCRIPT}'\nMAESTRO_PLATFORM=android maestro_dump_device_log f`],
        {
            encoding: 'utf8',
        },
    );

    return { calls: readFileSync(log, 'utf8').split('\n').filter(Boolean), output: result.stdout };
}

describe('the Android failure log dump', () => {
    const { calls, output } = dump();

    it('⛔ silences the Maestro tag in logcat itself, so the 4000 lines it reads are the app', () => {
        const logcat = calls.filter((call) => call.startsWith('adb logcat -d'));

        expect(logcat).toHaveLength(1);
        expect(logcat[0]?.split(' ')).toContain('Maestro:S');
    });

    it('still shows the app lines', () => {
        expect(output).toContain('ReactNativeJS: app line');
    });
});
