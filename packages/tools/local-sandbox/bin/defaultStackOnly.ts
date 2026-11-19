/**
 * `tsx bin/defaultStackOnly.ts <door>` — exit non-zero with one R9 line when the environment names a stack other than
 * the default one. `local:dev` and `dev:local` run it before anything starts.
 */
import { defaultStackOnlyRefusal } from '../src/defaultStackOnly.js';

const door = process.argv[2] ?? 'local:dev';
const refusal = defaultStackOnlyRefusal(door, process.env);

if (refusal !== undefined) {
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 1;
}
