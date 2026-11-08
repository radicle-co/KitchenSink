/**
 * The runner's SCREEN RECORDER: with `MAESTRO_SCREEN_RECORD=<file>` set (by the local lane orchestrator), the runner
 * collects the `COMMISE_SCREEN <name>` lines the test build logs while a flow runs, and appends
 * `screen<TAB>flow<TAB>name` lines and one `result<TAB>flow<TAB>passed|failed|skipped` line to the file. The after-run
 * check (`@kitchensink/e2e-plan/recordedScreens`) reads that file.
 *
 * Executed as real `bash` with `adb`, `xcrun`, `maestro`, `node` and `npx` replaced by stubs on `PATH`. The functions are
 * tested by sourcing the script (its dispatch runs only when executed), and the wiring by one run-mode pass.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

const scratch: string[] = [];

afterAll(() => {
    for (const dir of scratch) {
        rmSync(dir, { recursive: true, force: true });
    }
});

const ANDROID_LINES = [
    'I ReactNativeJS: noise',
    'COMMISE_SCREEN login',
    "'COMMISE_SCREEN HomeScreen'",
    'COMMISE_SCREEN HomeScreen',
];
const IOS_LINES = [
    '2026-11-07 14:50:01.123 Df App[12:34] [com.facebook.react.log:javascript] COMMISE_SCREEN signup',
    '2026-11-07 14:50:02.456 Df App[12:34] [com.facebook.react.log:javascript] COMMISE_SCREEN HomeScreen',
];

interface Fixture {
    readonly dir: string;
    readonly record: string;
    readonly calls: string;
}

function fixture(): Fixture {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-screen-record-'));
    scratch.push(dir);
    const calls = join(dir, 'calls.log');
    writeFileSync(calls, '');

    const stub = (name: string, body: string): void => {
        writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
        chmodSync(join(dir, name), 0o755);
    };

    const log = `printf '%s' "$(basename "$0")" >> "${calls}"; printf ' %s' "$@" >> "${calls}"; printf '\\n' >> "${calls}"`;
    const printAll = (lines: readonly string[]): string => lines.map((line) => `echo "${line}"`).join('\n');

    // `adb logcat` prints the app's lines and then stays alive, as the real one does; the runner must stop it.
    stub(
        'adb',
        `${log}\nif [ "\${1:-}" = logcat ] && [[ " $* " != *" -c "* ]] && [[ " $* " != *" -d "* ]]; then\n${printAll(ANDROID_LINES)}\nexec sleep 60\nfi\nexit 0`,
    );
    stub('xcrun', `${log}\n${printAll(IOS_LINES)}`);
    stub('maestro', `${log}\nexit "\${STUB_MAESTRO_EXIT:-0}"`);

    for (const name of ['node', 'npx']) {
        stub(name, `${log}\nexit 0`);
    }

    return { dir, record: join(dir, 'screenRecord.tsv'), calls };
}

/** Source the runner and run `body` in its shell, with the stubs first on PATH. */
function inRunner(f: Fixture, body: string, env: Readonly<Record<string, string>> = {}) {
    const inherited: Record<string, string | undefined> = { ...process.env };

    for (const name of ['MAESTRO_SCREEN_RECORD', 'MAESTRO_PLATFORM', 'ANDROID_SERIAL', 'MAESTRO_LOCAL']) {
        delete inherited[name];
    }

    const run = spawnSync('bash', ['-c', `source "${SCRIPT}"; ${body}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...inherited, PATH: `${f.dir}:${process.env['PATH'] ?? ''}`, ...env },
    });

    return { output: `${run.stdout}${run.stderr}`, status: run.status ?? -1 };
}

const recordOf = (f: Fixture): readonly string[] =>
    existsSync(f.record) ? readFileSync(f.record, 'utf8').split('\n').filter(Boolean) : [];

describe('maestro_screen_record_* on Android', () => {
    it('appends each distinct screen once, in the order first shown, then the result', () => {
        const f = fixture();
        const run = inRunner(f, 'maestro_screen_record_start; sleep 1; maestro_screen_record_stop recipes/rating 0', {
            MAESTRO_SCREEN_RECORD: f.record,
        });

        expect(run.status, run.output).toBe(0);
        expect(recordOf(f)).toEqual([
            'screen\trecipes/rating\tlogin',
            'screen\trecipes/rating\tHomeScreen',
            'result\trecipes/rating\tpassed',
        ]);
    });

    it('records a failing flow as failed and keeps the screens it showed', () => {
        const f = fixture();

        inRunner(f, 'maestro_screen_record_start; sleep 1; maestro_screen_record_stop home 1', {
            MAESTRO_SCREEN_RECORD: f.record,
        });

        expect(recordOf(f).at(-1)).toBe('result\thome\tfailed');
        expect(recordOf(f)).toContain('screen\thome\tlogin');
    });

    it('stops the log reader it started, so lanes do not pile up readers', () => {
        const f = fixture();
        const run = inRunner(
            f,
            'maestro_screen_record_start; sleep 1; pid=$MAESTRO_SCREEN_PID; maestro_screen_record_stop home 0; kill -0 "$pid" 2>/dev/null && echo ALIVE || echo GONE',
            { MAESTRO_SCREEN_RECORD: f.record },
        );

        expect(run.output).toContain('GONE');
    });

    it('does nothing at all when MAESTRO_SCREEN_RECORD is unset (CI, and every run before the recorder)', () => {
        const f = fixture();

        const run = inRunner(f, 'maestro_screen_record_start; maestro_screen_record_stop home 0');

        expect(run.status, run.output).toBe(0);
        expect(readFileSync(f.calls, 'utf8')).toBe('');
        expect(existsSync(f.record)).toBe(false);
    });

    it('records a skipped flow', () => {
        const f = fixture();

        inRunner(f, 'maestro_screen_record_result home skipped', { MAESTRO_SCREEN_RECORD: f.record });

        expect(recordOf(f)).toEqual(['result\thome\tskipped']);
    });
});

describe('maestro_screen_record_* on iOS', () => {
    it('reads the Simulator log from the flow start, filtered to the tag, and records the screens', () => {
        const f = fixture();
        const run = inRunner(f, 'maestro_screen_record_start; maestro_screen_record_stop auth/loginFlow 0', {
            MAESTRO_SCREEN_RECORD: f.record,
            MAESTRO_PLATFORM: 'ios',
            MAESTRO_IOS_UDID: 'UDID-1',
            MAESTRO_IOS_LOG_START: '2026-11-07 14:49:00',
        });

        expect(run.status, run.output).toBe(0);
        expect(recordOf(f)).toEqual([
            'screen\tauth/loginFlow\tsignup',
            'screen\tauth/loginFlow\tHomeScreen',
            'result\tauth/loginFlow\tpassed',
        ]);

        const call = readFileSync(f.calls, 'utf8');

        expect(call).toContain('simctl spawn UDID-1 log show');
        expect(call).toContain('--start 2026-11-07 14:49:00');
        expect(call).toContain('COMMISE_SCREEN');
    });
});

describe('run mode with the recorder on', () => {
    const runMode = (maestroExit: string, earlierRecord?: string): { f: Fixture; status: number } => {
        const f = fixture();

        if (earlierRecord !== undefined) {
            writeFileSync(f.record, earlierRecord);
        }

        const manifest = join(f.dir, 'fixture.env');
        writeFileSync(manifest, 'E2E_SIGNIN_EMAIL=x@example.com\n');
        const run = spawnSync('bash', [SCRIPT], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 60_000,
            env: {
                ...process.env,
                PATH: `${f.dir}:${process.env['PATH'] ?? ''}`,
                E2E_SEED_CLI_DIR: '',
                MAESTRO_FIXTURE_ENV_FILE: manifest,
                MAESTRO_FLOW_SELECTOR: 'flow:recipes/edit=true',
                MAESTRO_LOCAL: '1',
                MAESTRO_SKIP_INSTALL: '1',
                ANDROID_SERIAL: 'emulator-5558',
                MAESTRO_SCREEN_RECORD: f.record,
                STUB_MAESTRO_EXIT: maestroExit,
            },
        });

        return { f, status: run.status ?? -1 };
    };

    it('records the flow it ran, with its screens and its result', () => {
        const { f, status } = runMode('0');

        expect(status).toBe(0);
        expect(recordOf(f)).toEqual([
            'screen\trecipes/edit\tlogin',
            'screen\trecipes/edit\tHomeScreen',
            'result\trecipes/edit\tpassed',
        ]);
    });

    /**
     * Found by the acceptance run of 2026-11-07: a lane's record file outlived the run before it (one a host crash
     * stopped, which also left NUL bytes in it), so the next run's check read both runs' results and refused the file.
     * Stale results could as well vouch for a flow this run never passed, and the green stamp reads them.
     */
    it('starts the record fresh, so an earlier run’s results never count for this one', () => {
        const { f, status } = runMode('0', 'result\trecipes/landscape\tpassed\n\0\0\0\0\n');

        expect(status).toBe(0);
        expect(recordOf(f)).toEqual([
            'screen\trecipes/edit\tlogin',
            'screen\trecipes/edit\tHomeScreen',
            'result\trecipes/edit\tpassed',
        ]);
    });

    it('records the flow as failed when maestro fails', () => {
        const { f, status } = runMode('1');

        expect(status).not.toBe(0);
        expect(recordOf(f).at(-1)).toBe('result\trecipes/edit\tfailed');
    });
});
