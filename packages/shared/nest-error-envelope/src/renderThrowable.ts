import { inspect } from 'node:util';

/**
 * How deep `inspect` follows nested values. A cause chain is one level per link, so this bounds how many links
 * are printed; `inspect` marks a cycle as `[Circular]` on its own, so it also terminates on a cause that points
 * back at an ancestor.
 */
const CAUSE_DEPTH = 6;

/**
 * Render a thrown value for a SERVER LOG, including its `cause` chain.
 *
 * ⛔ WHY NOT `exception.stack`, which is what every filter logged: `Error.prototype.stack` describes the outer
 * error ALONE. Drizzle wraps a driver failure as `new DrizzleQueryError(…, { cause })`, so the 2026-09-11 k6 500s
 * logged "Failed query" and nothing under it — the Postgres error that explained them was dropped at the log
 * line. `util.inspect` is Node's own renderer for exactly this: it prints the stack, every own property (the
 * driver's SQLSTATE `code`, `severity`, …) and each `[cause]` in turn, and it handles a cyclic chain.
 *
 * ⚠️ FOR LOGS ONLY — never a response body. The envelope deliberately carries none of this (a stack fragment,
 * a connection string or a row's contents must not reach a caller).
 *
 * @param exception - Whatever was thrown.
 * @returns The rendered error with its causes, or the value's string form when it is not an `Error`. Pure.
 */
export function renderThrowable(exception: unknown): string {
    return exception instanceof Error ? inspect(exception, { depth: CAUSE_DEPTH }) : String(exception);
}
