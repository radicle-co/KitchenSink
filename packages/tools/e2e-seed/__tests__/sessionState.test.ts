/**
 * `readSessionState` — the boundary that decides WHOSE ROWS A RESET DELETES.
 *
 * ⛔ THE SHARD IS THE DANGEROUS FIELD. `provision` writes the leased shard into the state file and ~35
 * `reset` processes read it back; it selects which signer's library a reset reconciles. A value this
 * function accepts and should not is not a type error later — it is another pool slot's world being purged.
 *
 * ⚠️ WRITTEN BECAUSE A REVIEW CAUGHT THE COMMENT OVERCLAIMING. The first guard read
 * `if (shard !== undefined && …)`, so an ABSENT shard parsed clean and the throw still came from
 * `maestroSlotForShard` one module over — while the comment above it claimed this module now owned the
 * invariant. `SessionState.shard` is declared `readonly shard: number`, REQUIRED, so absence is exactly as
 * invalid as `"2"`, and the absent case below is the one that failed first.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readSessionState } from '../src/sessionState.js';

/** Write `body` as a state file and hand back its path. */
function stateFile(body: unknown): string {
    const path = join(mkdtempSync(join(tmpdir(), 'e2e-seed-state-')), 'session.json');

    writeFileSync(path, JSON.stringify(body), 'utf8');

    return path;
}

const handle = { sessionId: 's', devJwt: 'j', fapi: 'f', origin: 'o', email: 'e' };
const valid = { runKey: 'local-1', shard: 1, signer: handle, coAuthor: handle };

describe('readSessionState', () => {
    it('round-trips a well-formed state file', () => {
        expect(readSessionState(stateFile(valid)).shard).toBe(1);
    });

    it('⛔ refuses a shard that is not a number', () => {
        expect(() => readSessionState(stateFile({ ...valid, shard: '2' }))).toThrow(/shard/iu);
    });

    /** The case the old `shard !== undefined` guard let through. */
    it('⛔ refuses a state file with NO shard at all', () => {
        const { shard, ...withoutShard } = valid;

        expect(shard).toBe(1);
        expect(() => readSessionState(stateFile(withoutShard))).toThrow(/shard/iu);
    });

    it('⛔ refuses a non-positive shard, which would index the roster from the wrong end', () => {
        expect(() => readSessionState(stateFile({ ...valid, shard: 0 }))).toThrow(/shard/iu);
    });
});
