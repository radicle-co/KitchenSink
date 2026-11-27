/**
 * The rerun history file: `<state root>/localMaestro/rerunHistory.json`, mode 0600, written to a
 * temp file and renamed. A missing file is an empty history. A file that fails its parse is reported once and read as
 * empty: it is never a crash.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRerunHistory, writeRerunHistory } from '../rerunHistoryStore.js';
import { EMPTY_RERUN_HISTORY, recordOutcomes } from '../rerunLimit.js';

const NOW = '2026-11-27T10:00:00.000Z';
let dir: string;
let file: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rerunStore-'));
    file = path.join(dir, 'localMaestro', 'rerunHistory.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('readRerunHistory', () => {
    it('reads a missing file as an empty history and says nothing', () => {
        const report = vi.fn();

        expect(readRerunHistory(file, report)).toEqual(EMPTY_RERUN_HISTORY);
        expect(report).not.toHaveBeenCalled();
    });

    it.each([
        ['not JSON', '{ torn'],
        ['the wrong shape', JSON.stringify({ version: 1, entries: { k: { failures: 'two' } } })],
        ['an older version', JSON.stringify({ version: 0, entries: {} })],
    ])('reads %s as empty and reports it once, naming the file (mutant: a crash, or silence)', (_name, text) => {
        writeRerunHistory(file, EMPTY_RERUN_HISTORY);
        writeFileSync(file, text);
        const report = vi.fn();

        expect(readRerunHistory(file, report)).toEqual(EMPTY_RERUN_HISTORY);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith(expect.stringContaining(file));
    });
});

describe('writeRerunHistory', () => {
    it('round trips what it wrote, so a count survives the door ending', () => {
        const history = recordOutcomes(EMPTY_RERUN_HISTORY, [{ key: 'a|b|c|d|e', failed: true }], NOW);

        writeRerunHistory(file, history);

        expect(readRerunHistory(file, vi.fn())).toEqual(history);
    });

    it('writes mode 0600 (mutant: a world-readable file)', () => {
        writeRerunHistory(file, EMPTY_RERUN_HISTORY);

        expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it('keeps mode 0600 when it replaces a file that was looser', () => {
        writeRerunHistory(file, EMPTY_RERUN_HISTORY);
        writeFileSync(file, '{}', { mode: 0o644 });

        writeRerunHistory(file, EMPTY_RERUN_HISTORY);

        expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it('creates the folder, and leaves no temp file behind (mutant: a write in place that tears)', () => {
        writeRerunHistory(file, EMPTY_RERUN_HISTORY);

        expect(existsSync(file)).toBe(true);
        expect(readdirSync(path.dirname(file))).toEqual(['rerunHistory.json']);
    });

    it('replaces the file by rename, so a reader sees the old file or the new one (mutant: a write in place)', () => {
        writeRerunHistory(file, EMPTY_RERUN_HISTORY);
        const before = statSync(file).ino;

        writeRerunHistory(file, recordOutcomes(EMPTY_RERUN_HISTORY, [{ key: 'k', failed: true }], NOW));

        // A write in place keeps the inode it truncates; a rename puts a new file there.
        expect(statSync(file).ino).not.toBe(before);
    });

    it('two outcome writes in order keep both counts', () => {
        const key = 'ios|iphone|recipes/detailCooking|1a2b3c4|blobX';
        const other = 'ios|iphone|recipes/home|1a2b3c4|blobY';

        writeRerunHistory(file, recordOutcomes(readRerunHistory(file, vi.fn()), [{ key, failed: true }], NOW));
        writeRerunHistory(file, recordOutcomes(readRerunHistory(file, vi.fn()), [{ key: other, failed: true }], NOW));
        writeRerunHistory(file, recordOutcomes(readRerunHistory(file, vi.fn()), [{ key, failed: true }], NOW));

        const kept = readRerunHistory(file, vi.fn());

        expect(kept.entries[key]).toMatchObject({ failures: 2 });
        expect(kept.entries[other]).toMatchObject({ failures: 1 });
    });
});
