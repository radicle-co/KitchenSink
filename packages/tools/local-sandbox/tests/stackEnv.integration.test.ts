/**
 * `bin/stackEnv.ts` as a process, against a stub `docker` that answers `docker port` only for the container ports the
 * real stack publishes (every service holds 3000 inside its container, LocalStack 4566, Postgres 5432), as real Docker
 * does: any other port is `no public port` and a non-zero exit. A wrong container port in the door fails here, and a
 * unit test that never spawns Docker cannot see it.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../bin/adapters.js';

const PROJECT = 'local-sandbox-3100';
let dir = '';

/** A `docker` that lists the project's containers from this checkout and publishes the shifted host ports. */
function installDocker(workingDir: string): void {
    const script = [
        '#!/bin/sh',
        'case "$1" in',
        `  ps) printf '%s\\t%s\\n' '${PROJECT}' '${workingDir}' ;;`,
        '  port)',
        '    case "$2 $3" in',
        `      "${PROJECT}-recipes 3000") echo '0.0.0.0:3100' ;;`,
        `      "${PROJECT}-identity 3000") echo '0.0.0.0:3101' ;;`,
        `      "${PROJECT}-food 3000") echo '0.0.0.0:3102' ;;`,
        `      "${PROJECT}-localstack 4566") echo '0.0.0.0:4666' ;;`,
        `      "${PROJECT}-postgres 5432") echo '0.0.0.0:5532' ;;`,
        `      *) echo "no public port '$3' published for $2" >&2; exit 1 ;;`,
        '    esac ;;',
        'esac',
        '',
    ];

    writeFileSync(path.join(dir, 'docker'), script.join('\n'));
    chmodSync(path.join(dir, 'docker'), 0o755);
}

function stackEnv(env: Record<string, string>) {
    const result = spawnSync(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), ['bin/stackEnv.ts', 'maestro:lanes'], {
        cwd: path.join(REPO_ROOT, 'packages/tools/local-sandbox'),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}`, ...env },
    });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'stackEnv-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('stackEnv.ts against a stub Docker', () => {
    it('prints the shifted stack as KEY=value lines, and the stack line on stderr', () => {
        installDocker(`${REPO_ROOT}/.local-sandbox`);
        const result = stackEnv({ LOCAL_SANDBOX_PORT: '3100' });
        const lines = result.stdout.split('\n');

        expect(result.status).toBe(0);
        expect(lines).toContain('MAESTRO_LOCAL_RECIPE_HOST_PORT=3100');
        expect(lines).toContain('MAESTRO_LOCAL_IDENTITY_HOST_PORT=3101');
        expect(lines).toContain('MAESTRO_LOCAL_FOOD_HOST_PORT=3102');
        expect(lines).toContain('LOCAL_MAESTRO_LOCALSTACK=http://localhost:4666');
        expect(lines).toContain('LOCAL_MAESTRO_POSTGRES_PORT=5532');
        expect(result.stderr).toContain(`stack: ${PROJECT} (recipes 3100, identity 3101, food 3102) from ${REPO_ROOT}`);
    });

    it('a stack another checkout runs prints one refusal line and no KEY=value line', () => {
        installDocker('/work/A/.local-sandbox');
        const result = stackEnv({ LOCAL_SANDBOX_PORT: '3100' });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(
            `maestro:lanes refused: project ${PROJECT} runs from /work/A, not this checkout. Run local:down there.`,
        );
    });

    it('a stack that is not running says to run local:up, not that Docker failed', () => {
        installDocker(`${REPO_ROOT}/.local-sandbox`);
        const script = [
            '#!/bin/sh',
            'case "$1" in',
            '  ps) ;;',
            '  port) echo "Error response from daemon: No such container: $2" >&2; exit 1 ;;',
            'esac',
            '',
        ];

        writeFileSync(path.join(dir, 'docker'), script.join('\n'));
        const result = stackEnv({ LOCAL_SANDBOX_PORT: '3100' });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(
            `maestro:lanes refused: project ${PROJECT} has no containers. ` +
                'Run local:up with the same LOCAL_SANDBOX_PORT first.',
        );
    });

    it('a stopped stack is still "run local:up" while another project of another checkout runs', () => {
        installDocker('/work/B/.local-sandbox');
        const result = stackEnv({ LOCAL_SANDBOX_PORT: '3200' });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(
            'maestro:lanes refused: project local-sandbox-3200 has no containers. ' +
                'Run local:up with the same LOCAL_SANDBOX_PORT first.',
        );
    });

    it('a stack whose port read fails prints one refusal line and no KEY=value line', () => {
        installDocker(`${REPO_ROOT}/.local-sandbox`);
        writeFileSync(path.join(dir, 'docker'), "#!/bin/sh\necho 'daemon down' >&2\nexit 1\n");
        const result = stackEnv({ LOCAL_SANDBOX_PORT: '3100' });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(
            'maestro:lanes refused: docker ps -a failed (daemon down). ' +
                'Start Docker, or fix it, then run maestro:lanes again.',
        );
    });
});
