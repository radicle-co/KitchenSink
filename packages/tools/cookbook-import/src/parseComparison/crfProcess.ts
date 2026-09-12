/**
 * THE CRF ADAPTER — one Python process, one whole corpus.
 *
 * DESIGN PATTERN: **Adapter over a narrow port.** The port is a line-oriented stdin/stdout protocol; the
 * shape check is `crfParse.ts`'s, the flattening is the sidecar's, and this file owns only the process.
 *
 * ⛔ ONE PROCESS FOR THE WHOLE CORPUS, not one per line. `ingredient-parser-nlp` loads a CRF model at
 * import; per-line spawning would pay that load thousands of times and would turn a two-second job into a
 * quarter of an hour. It also means a crash costs the whole batch, which is why the exit status and stderr
 * are surfaced rather than swallowed — a half-read stream would silently shrink the denominator of every
 * agreement rate in the report.
 *
 * ⚠️ INPUT IS JSON-ENCODED, NOT RAW. A corpus line is 1919 prose and may carry quotes, braces or (once
 * joined) a newline. Writing raw lines into a line-oriented protocol is how one hostile line desynchronises
 * the whole stream; encoding each as a JSON string makes that unrepresentable.
 *
 * ⛔ THE ECHO IS ASSERTED, NOT TRUSTED. The sidecar returns the sentence it was given precisely so the
 * caller can check the pairing, and a count check alone is not that check: any count-preserving reordering
 * or off-by-one inside the sidecar would pair every model answer with a DIFFERENT line's CRF reading, and
 * every agreement figure in the report would describe randomly paired lines while looking perfectly clean.
 * It is the one failure here that corrupts the headline result silently and totally.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readCrfParseLine, type CrfParse } from './crfParse.js';

/**
 * Where the sidecar lives.
 *
 * ⚠️ Through `fileURLToPath`, never `URL.pathname`: the latter is percent-encoded and not a valid path, so
 * a space in any ancestor directory becomes `%20` and a `#` truncates the path outright. This repository
 * lives under a `.claude/worktrees/…` path today, but the next checkout is not ours to choose.
 */
const SIDECAR_PATH = fileURLToPath(new URL('../../scripts/crfParse.py', import.meta.url));

/** What one CRF run needs beyond the lines. */
export interface CrfRunOptions {
    /** The interpreter to run. */
    readonly python?: string | undefined;
    /**
     * The sidecar script.
     *
     * ⚠️ A parameter, not a constant, so the adapter's four failure paths — a non-zero exit, an unreadable
     * row, a row-count mismatch and a broken pipe — are reachable from the unit tier with a two-line fake
     * instead of only from a machine that has the CRF model installed.
     */
    readonly script?: string | undefined;
}

/**
 * Parse every line with the real CRF model.
 *
 * @param lines - The corpus lines, in order.
 * @param options - Interpreter and sidecar overrides; both default to the real ones.
 * @returns One parse per line, in the order the lines were given.
 * @throws When the sidecar exits non-zero, prints an unreadable row, returns the wrong number of rows, or
 *   echoes a sentence that is not the line it was given.
 * @sideEffect Spawns a Python process and writes to its stdin.
 */
export async function parseLinesWithCrf(
    lines: readonly string[],
    options: CrfRunOptions = {},
): Promise<readonly CrfParse[]> {
    if (lines.length === 0) {
        return [];
    }

    const child = spawn(options.python ?? 'python3', [options.script ?? SIDECAR_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // ⛔ A corpus is ~130 KB, well past the 64 KB pipe buffer, so a sidecar that dies mid-stream — the
    // overwhelmingly likely failure, `ingredient-parser-nlp` not installed — breaks the pipe half way
    // through the write. Without this listener Node raises EPIPE as an uncaught error and the process dies
    // with a stack trace, making the exit-code-and-stderr diagnostic below unreachable in exactly the case
    // it exists for. Swallowing it here lets `close` report what actually happened.
    child.stdin.on('error', () => undefined);

    const finished = new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    });

    child.stdin.end(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    const code = await finished;
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

    if (code !== 0) {
        throw new Error(`crfParse.py exited ${code}${stderr === '' ? '' : `: ${stderr}`}`);
    }

    const rows = Buffer.concat(stdoutChunks)
        .toString('utf8')
        .split('\n')
        .filter((row) => row.trim().length > 0)
        .map(readCrfParseLine);

    if (rows.length !== lines.length) {
        throw new Error(`crfParse.py returned ${rows.length} rows for ${lines.length} lines`);
    }

    rows.forEach((row, index) => {
        if (row.sentence !== lines[index]) {
            throw new Error(
                `crfParse.py row ${index} echoed ${JSON.stringify(row.sentence)} for line ` +
                    `${JSON.stringify(lines[index])} — the stream is mispaired`,
            );
        }
    });

    return rows;
}
