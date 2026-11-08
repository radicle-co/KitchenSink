// @vitest-environment node
/**
 * Free memory for the lane planner. Linux and Windows answer from `os.freemem()` (libuv reads `MemAvailable` on Linux).
 * macOS cannot: libuv counts only never-used pages there, and a Mac that has been up a day reports a few hundred MB
 * free with gigabytes reclaimable, which would plan zero lanes. `vm_stat` names the reclaimable pages.
 */
import { describe, expect, it } from 'vitest';

import { availableMemoryBytes, parseVmStat } from '../machineMemory';

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            500000.
Pages inactive:                           40000.
Pages speculative:                         2000.
Pages throttled:                              0.
Pages wired down:                        200000.
Pages purgeable:                           3000.
"Translation faults":                 123456789.
File-backed pages:                       100000.
`;

describe('parseVmStat', () => {
    it('adds the free, inactive and speculative pages (not purgeable, which may already be inside inactive) and multiplies by the page size', () => {
        expect(parseVmStat(VM_STAT)).toBe((10000 + 40000 + 2000) * 16384);
    });

    it('reads a 4 KiB page size', () => {
        expect(parseVmStat(VM_STAT.replace('16384', '4096'))).toBe((10000 + 40000 + 2000) * 4096);
    });

    it('throws on text it cannot read, because a guess would plan the wrong lane count', () => {
        expect(() => parseVmStat('not vm_stat output')).toThrow(/vm_stat/u);
    });
});

describe('availableMemoryBytes', () => {
    it('answers os.freemem() off macOS', () => {
        expect(availableMemoryBytes({ platform: 'linux', freemem: () => 123, vmStat: () => 'unused' })).toBe(123);
    });

    it('answers vm_stat on macOS', () => {
        expect(availableMemoryBytes({ platform: 'darwin', freemem: () => 1, vmStat: () => VM_STAT })).toBe(
            52000 * 16384,
        );
    });

    it('falls back to os.freemem() when vm_stat cannot be run on macOS', () => {
        const throwing = (): string => {
            throw new Error('no vm_stat');
        };

        expect(availableMemoryBytes({ platform: 'darwin', freemem: () => 77, vmStat: throwing })).toBe(77);
    });
});
