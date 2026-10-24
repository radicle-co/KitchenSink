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
const valid = {
    runKey: 'local-1',
    platform: 'android',
    shard: 1,
    signer: handle,
    coAuthor: handle,
    ambiguityWord: 'mirin',
};

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

    /**
     * ADDED 2026-10-13. The platform decides WHICH lane's signer a reset reconciles, exactly as the shard does, so it
     * is parsed as strictly: an absent or unknown platform is a state file from before the lanes were split, and
     * resetting "some" signer from it would purge a live run's world.
     */
    it('round-trips both platforms', () => {
        expect(readSessionState(stateFile({ ...valid, platform: 'ios' })).platform).toBe('ios');
        expect(readSessionState(stateFile(valid)).platform).toBe('android');
    });

    it('⛔ refuses a state file with NO platform at all', () => {
        const { platform, ...withoutPlatform } = valid;

        expect(platform).toBe('android');
        expect(() => readSessionState(stateFile(withoutPlatform))).toThrow(/platform/iu);
    });

    it.each([['windows'], ['IOS'], [''], [null], [1], [['ios']]])('⛔ refuses the platform %j', (platform) => {
        expect(() => readSessionState(stateFile({ ...valid, platform }))).toThrow(/platform/iu);
    });

    it('reports a bad platform as itself, not as a missing state file', () => {
        expect(() => readSessionState(stateFile({ ...valid, platform: 'windows' }))).not.toThrow(/provision/u);
    });

    /**
     * ADDED 2026-10-20. `provision` chooses the ambiguity word against the live search, and `reset --mode ambiguity`
     * makes the probe's food and lines from it. The state file is the one channel between the two, so the word is parsed as
     * strictly as the shard: a reset that fell back to a literal word would make a probe nobody verified, which is the
     * failure the probe words exist to prevent.
     */
    it('round-trips the ambiguity word provision chose', () => {
        expect(readSessionState(stateFile(valid)).ambiguityWord).toBe('mirin');
    });

    it('⛔ refuses a state file with NO ambiguity word at all', () => {
        const { ambiguityWord, ...withoutWord } = valid;

        expect(ambiguityWord).toBe('mirin');
        expect(() => readSessionState(stateFile(withoutWord))).toThrow(/ambiguity word/iu);
    });

    it.each([[''], [null], [1], ['Mirin'], ['apple sauce'], ['mirin.*'], [['mirin']]])(
        '⛔ refuses the ambiguity word %j, which is not one lowercase word a Maestro pattern can carry',
        (ambiguityWord) => {
            expect(() => readSessionState(stateFile({ ...valid, ambiguityWord }))).toThrow(/ambiguity word/iu);
        },
    );

    it('reports a bad ambiguity word as itself, not as a missing state file', () => {
        expect(() => readSessionState(stateFile({ ...valid, ambiguityWord: '' }))).not.toThrow(/provision` must run/u);
    });
});
