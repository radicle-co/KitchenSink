import { describe, expect, it } from 'vitest';

import {
    availableMemoryBytes,
    bytesFromFreePercent,
    isMemoryReadError,
    MEMORY_SAFETY_MARGIN,
    parseFreePercent,
    type MemorySources,
} from '../src/hostMemory.js';

const GIB = 1024 ** 3;
const OUTPUT = [
    'The system has 17179869184 (4194304 pages with a page size of 4096).',
    'Stats:',
    'Pages free: 20000',
    '',
    'System-wide memory free percentage: 62%',
].join('\n');

describe('parseFreePercent', () => {
    it('reads the system-wide free percentage', () => {
        expect(parseFreePercent(OUTPUT)).toBe(62);
        expect(parseFreePercent('System-wide memory free percentage: 0%')).toBe(0);
    });

    it.each([
        ['no line', 'The system has 17179869184 bytes'],
        ['a percentage above 100', 'System-wide memory free percentage: 140%'],
        ['empty output', ''],
    ])('throws a named error for %s', (_name, text) => {
        expect(() => parseFreePercent(text)).toThrow(/memory_pressure/u);

        try {
            parseFreePercent(text);
        } catch (error) {
            expect(isMemoryReadError(error)).toBe(true);
        }
    });
});

describe('bytesFromFreePercent', () => {
    it('counts only a margin of what the kernel calls free: it includes pages it reclaims under pressure', () => {
        expect(MEMORY_SAFETY_MARGIN).toBe(0.8);
        expect(bytesFromFreePercent(16 * GIB, 50)).toBe(Math.floor(16 * GIB * 0.5 * 0.8));
    });

    it('is zero at zero and below the machine size at 100', () => {
        expect(bytesFromFreePercent(16 * GIB, 0)).toBe(0);
        expect(bytesFromFreePercent(16 * GIB, 100)).toBeLessThan(16 * GIB);
    });
});

const sources = (over: Partial<MemorySources> = {}): MemorySources => ({
    platform: 'darwin',
    freemem: () => 3 * GIB,
    totalmem: () => 16 * GIB,
    memoryPressure: () => OUTPUT,
    ...over,
});

describe('availableMemoryBytes', () => {
    it('uses os.freemem() off macOS, where it is the right figure', () => {
        expect(availableMemoryBytes(sources({ platform: 'linux' }))).toBe(3 * GIB);
    });

    it('reads memory_pressure on macOS and ignores os.freemem(), which counts only never-used pages', () => {
        expect(availableMemoryBytes(sources())).toBe(Math.floor(16 * GIB * 0.62 * 0.8));
    });

    it('refuses to plan when memory_pressure cannot be read, with a named error, and never falls back', () => {
        const failing = sources({
            memoryPressure: () => {
                throw new Error('spawn memory_pressure ENOENT');
            },
        });

        expect(() => availableMemoryBytes(failing)).toThrow(/memory_pressure/u);

        try {
            availableMemoryBytes(failing);
        } catch (error) {
            expect(isMemoryReadError(error)).toBe(true);
        }
    });

    it('refuses when the output is not the output it expects', () => {
        expect(() => availableMemoryBytes(sources({ memoryPressure: () => 'garbage' }))).toThrow(/memory_pressure/u);
    });
});
