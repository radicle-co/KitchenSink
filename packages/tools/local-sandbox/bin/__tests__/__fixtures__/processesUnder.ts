import { readFileSync, readdirSync } from 'node:fs';

/** The pids of every process whose environment mentions `root`, this process excluded. */
function pidsUnder(root: string): number[] {
    const found: number[] = [];

    for (const name of readdirSync('/proc')) {
        if (!/^\d+$/u.test(name) || Number(name) === process.pid) {
            continue;
        }

        try {
            if (readFileSync(`/proc/${name}/environ`, 'utf8').includes(root)) {
                found.push(Number(name));
            }
        } catch {
            // The process ended, or belongs to another user: it is not ours to stop.
        }
    }

    return found;
}

/**
 * Stops every process a test started under its temp `root`, wherever it sits in the tree: a detached launcher, a job, a
 * build stub, a leftover daemon. They are found by the temp folder in their PATH, which every one of them inherited.
 *
 * @param root - The test's temp folder, the one its fake `bin` lives in.
 * @returns The pids that were still alive after the stop (empty when it worked). Linux only: it reads `/proc`.
 * @sideEffect Sends SIGKILL to those processes and waits up to two seconds for them to go.
 */
export async function stopProcessesUnder(root: string): Promise<number[]> {
    const deadline = Date.now() + 2000;
    let alive = pidsUnder(root);

    while (alive.length > 0 && Date.now() < deadline) {
        for (const pid of alive) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Already gone.
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
        alive = pidsUnder(root);
    }

    return alive;
}
