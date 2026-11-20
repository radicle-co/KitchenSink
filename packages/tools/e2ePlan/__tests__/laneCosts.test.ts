/**
 * `laneCosts.json` is the one place a lane's measured cost lives, read by the lane planners and by a user-level hook.
 * The loader must reject a malformed file rather than plan lanes from a guess, and the real file must carry the measured
 * numbers (a changed number is a new measurement, so it is a deliberate edit to this pin too).
 */
import { describe, expect, it } from 'vitest';

import { laneCosts, parseLaneCosts } from '../src/laneCosts.js';

const GIB = 1024 ** 3;

const valid = {
    android: { cpus: 5.5, gib: 5.5 },
    iphone: { cpus: 1, gib: 2.1 },
    ipad: { cpus: 1, gib: 2.2 },
    macAndroid: { cpus: 3, gib: 5.8 },
    web: { cpus: 0.75, gib: 1.5 },
    webServer: { cpus: 1, gib: 0.75 },
};

describe('parseLaneCosts', () => {
    it('accepts a well-formed file and converts GiB to bytes', () => {
        expect(parseLaneCosts(valid).android).toEqual({ cpus: 5.5, memBytes: 5.5 * GIB });
        expect(parseLaneCosts(valid).iphone.memBytes).toBe(Math.round(2.1 * GIB));
    });

    it('throws when a lane is missing', () => {
        const { ipad: _ipad, ...rest } = valid;

        expect(() => parseLaneCosts(rest)).toThrow(/ipad/u);
    });

    it('throws on a non-numeric, zero or negative figure', () => {
        expect(() => parseLaneCosts({ ...valid, web: { cpus: '0.75', gib: 1.5 } })).toThrow();
        expect(() => parseLaneCosts({ ...valid, web: { cpus: 0, gib: 1.5 } })).toThrow();
        expect(() => parseLaneCosts({ ...valid, web: { cpus: 1, gib: -1 } })).toThrow();
    });

    it('throws on an unknown lane or field, so a typo cannot silently drop a cost', () => {
        expect(() => parseLaneCosts({ ...valid, tablet: { cpus: 1, gib: 1 } })).toThrow();
        expect(() => parseLaneCosts({ ...valid, web: { cpus: 1, gib: 1, mem: 2 } })).toThrow();
    });

    it('throws on a non-object', () => {
        expect(() => parseLaneCosts(null)).toThrow();
    });
});

describe('laneCosts (the real file)', () => {
    it('carries the measured numbers', () => {
        expect(laneCosts).toEqual({
            android: { cpus: 5.5, memBytes: 5.5 * GIB },
            iphone: { cpus: 1, memBytes: Math.round(2.1 * GIB) },
            ipad: { cpus: 1, memBytes: Math.round(2.2 * GIB) },
            macAndroid: { cpus: 3, memBytes: Math.round(5.8 * GIB) },
            web: { cpus: 0.75, memBytes: 1.5 * GIB },
            webServer: { cpus: 1, memBytes: 0.75 * GIB },
        });
    });
});
