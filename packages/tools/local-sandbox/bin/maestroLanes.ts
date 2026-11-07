/**
 * `npm run maestro:lanes -- --platform android|ios|both [--lanes <n>] [--flows <f…>]` — the local Maestro lane
 * orchestrator. NOT BUILT YET: this is the door's interface, so its callers can be wired first. It refuses with a
 * non-zero exit, because a door that exits 0 having run nothing is a green over no work.
 *
 * @sideEffect Writes to stderr and sets the exit code.
 */
process.stderr.write('maestro:lanes: not built yet - use `npm run local:maestro` for now\n');
process.exitCode = 1;
