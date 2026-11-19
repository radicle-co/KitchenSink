/**
 * `npm run local:down` — stop the local stack the `LOCAL_SANDBOX_PORT` variable names, keeping its Postgres volume.
 *
 * @sideEffect Takes the project lock and runs `docker compose -p <project> down`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { stateRoot } from '@kitchensink/e2e-plan/stampRun';

import { acquireHostLock, currentBootId, pidIsAlive } from '../src/maestroLanes/hostLock.js';
import { runDown } from '../src/runDown.js';
import { canonicalPath } from '../src/canonicalPath.js';
import { composeContainersFrom } from '../src/stackPorts.js';
import { REPO_ROOT } from './adapters.js';

const stateDir = path.join(stateRoot(), 'localSandbox');

process.exitCode = runDown({
    env: process.env,
    checkout: REPO_ROOT,
    canon: canonicalPath,
    stateDir,
    containers: () =>
        composeContainersFrom(
            spawnSync(
                'docker',
                [
                    'ps',
                    '-a',
                    '--format',
                    '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}',
                ],
                { encoding: 'utf8' },
            ).stdout ?? '',
        ),
    acquireLock: (file) => {
        mkdirSync(stateDir, { recursive: true });

        return acquireHostLock(file, process.pid, pidIsAlive, currentBootId(), 'local:down');
    },
    down: (project) => spawnSync('docker', ['compose', '-p', project, 'down'], { stdio: 'inherit' }).status ?? 1,
    out: (line) => {
        process.stdout.write(`${line}\n`);
    },
    err: (line) => {
        process.stderr.write(`${line}\n`);
    },
});
