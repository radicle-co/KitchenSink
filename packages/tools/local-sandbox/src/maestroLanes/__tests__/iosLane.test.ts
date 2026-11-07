import { describe, expect, it } from 'vitest';

import {
    IOS_MAX_LANES,
    driverPortFor,
    laneSimulatorName,
    macHostFromEnv,
    parseHostFacts,
    sshConfigText,
    tunnelsFromManifest,
} from '../iosLane.js';

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    92131.
Pages active:                                 967331.
Pages inactive:                               900000.
Pages speculative:                             8000.
Pages wired down:                             300000.
`;

describe('parseHostFacts', () => {
    it('reads cpus, the one-minute load and available memory from captured Mac output', () => {
        const facts = parseHostFacts(
            ['ncpu 14', 'memsize 51539607552', 'loadavg { 2.76 2.60 2.96 }', VM_STAT].join('\n'),
        );
        expect(facts.cpus).toBe(14);
        expect(facts.load1).toBeCloseTo(2.76);
        // (free + inactive + speculative) pages at the page size the output states, not an assumed 4096
        expect(facts.memAvailable).toBe((92131 + 900000 + 8000) * 16384);
    });

    it('throws on output that has no page size rather than guessing one', () => {
        expect(() => parseHostFacts('ncpu 2\nmemsize 1\nloadavg { 1 1 1 }\nPages free: 1.')).toThrow(/page size/);
    });
});

describe('lane naming and ports', () => {
    it('names lane Simulators by lane number', () => {
        expect(laneSimulatorName(3)).toBe('ks-maestro-lane-3');
    });

    it('puts the driver port at 7000 + lane', () => {
        expect(driverPortFor(1)).toBe(7001);
        expect(driverPortFor(5)).toBe(7005);
    });

    it('refuses a lane outside 1..IOS_MAX_LANES', () => {
        expect(IOS_MAX_LANES).toBe(5);
        expect(() => laneSimulatorName(0)).toThrow();
        expect(() => driverPortFor(IOS_MAX_LANES + 1)).toThrow();
    });
});

describe('macHostFromEnv', () => {
    it('refuses without LOCAL_MAESTRO_IOS_HOST', () => {
        expect(() => macHostFromEnv({})).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
        expect(() => macHostFromEnv({ LOCAL_MAESTRO_IOS_HOST: ' ' })).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
    });

    it('returns the host', () => {
        expect(macHostFromEnv({ LOCAL_MAESTRO_IOS_HOST: 'me@mac' })).toBe('me@mac');
    });
});

describe('tunnelsFromManifest', () => {
    const manifest = [
        'platform=ios',
        'recipeOrigin=http://localhost:13000',
        'identityOrigin=http://localhost:13001',
        'foodOrigin=http://localhost:13002',
    ].join('\n');

    it('tunnels each baked origin port back to that service on this machine', () => {
        expect(tunnelsFromManifest(manifest)).toEqual([
            { macPort: 13000, localPort: 3000 },
            { macPort: 13001, localPort: 3001 },
            { macPort: 13002, localPort: 3002 },
        ]);
    });

    it('refuses an origin that is not on localhost, because a tunnel cannot reach it', () => {
        expect(() => tunnelsFromManifest(manifest.replace('localhost:13000', 'recipe.example.com'))).toThrow(
            /recipeOrigin/,
        );
    });

    it('refuses a manifest missing an origin', () => {
        expect(() => tunnelsFromManifest('platform=ios\nrecipeOrigin=http://localhost:13000')).toThrow(
            /identityOrigin/,
        );
    });
});

describe('sshConfigText', () => {
    it('shares one connection per run and never prompts', () => {
        const text = sshConfigText({ host: 'me@mac', controlPath: '/tmp/cm-%C' });
        expect(text).toContain('Host *');
        expect(text).toContain('BatchMode yes');
        expect(text).toContain('ControlMaster auto');
        expect(text).toContain('ControlPath /tmp/cm-%C');
        expect(text).toContain('ServerAliveInterval 15');
    });
});
