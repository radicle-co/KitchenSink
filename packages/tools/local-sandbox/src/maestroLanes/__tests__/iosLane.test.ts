import { describe, expect, it } from 'vitest';

import {
    IOS_MAX_LANES,
    MEMORY_SAFETY_MARGIN,
    laneSimulatorName,
    macHostFromEnv,
    parseHostFacts,
    sshConfigText,
    tunnelsFromManifest,
} from '../iosLane.js';

const MEMSIZE = 51539607552;

/** `laneHost.sh facts` output captured on the Mac: ncpu, memsize, loadavg, and memory_pressure's free percentage. */
const facts = (extra: string): string =>
    ['ncpu 14', `memsize ${String(MEMSIZE)}`, 'loadavg { 2.76 2.60 2.96 }', extra].join('\n');

describe('parseHostFacts', () => {
    it('reads cpus, the one-minute load and available memory from captured Mac output', () => {
        const parsed = parseHostFacts(facts('memfreepct 62'));
        expect(parsed.cpus).toBe(14);
        expect(parsed.load1).toBeCloseTo(2.76);
        // The kernel's own free percentage counts the cache macOS gives back, which free + inactive pages from vm_stat
        // missed (16 GiB counted against about 30 GiB reclaimable on the same Mac). A margin is kept because the cache is
        // given back under pressure, not for free.
        expect(parsed.memAvailable).toBe(Math.floor(MEMSIZE * 0.62 * MEMORY_SAFETY_MARGIN));
    });

    it('keeps a margin under what the kernel reports', () => {
        expect(MEMORY_SAFETY_MARGIN).toBeLessThan(1);
        expect(parseHostFacts(facts('memfreepct 100')).memAvailable).toBeLessThan(MEMSIZE);
    });

    it('counts no memory at 0 percent', () => {
        expect(parseHostFacts(facts('memfreepct 0')).memAvailable).toBe(0);
    });

    it('throws on output with no free percentage rather than guessing one', () => {
        expect(() => parseHostFacts(facts(''))).toThrow(/memfreepct/);
    });

    it('throws on a percentage outside 0..100', () => {
        expect(() => parseHostFacts(facts('memfreepct 140'))).toThrow(/memfreepct/);
    });
});

describe('lane naming and ports', () => {
    it('names lane Simulators by lane number', () => {
        expect(laneSimulatorName(3)).toBe('ks-maestro-lane-3');
    });

    it('refuses a lane outside 1..IOS_MAX_LANES', () => {
        expect(IOS_MAX_LANES).toBe(5);
        expect(() => laneSimulatorName(0)).toThrow();
        expect(() => laneSimulatorName(IOS_MAX_LANES + 1)).toThrow();
    });
});

describe('macHostFromEnv', () => {
    it('refuses without LOCAL_MAESTRO_IOS_HOST', () => {
        expect(() => macHostFromEnv({})).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
        expect(() => macHostFromEnv({ LOCAL_MAESTRO_IOS_HOST: ' ' })).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
    });

    it('refuses a host that ssh would read as an option or that holds a space', () => {
        expect(() => macHostFromEnv({ LOCAL_MAESTRO_IOS_HOST: '-oProxyCommand=touch x' })).toThrow(
            /LOCAL_MAESTRO_IOS_HOST/,
        );
        expect(() => macHostFromEnv({ LOCAL_MAESTRO_IOS_HOST: 'me@mac extra' })).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
    });

    it('returns the host', () => {
        expect(macHostFromEnv({ LOCAL_MAESTRO_IOS_HOST: 'me@mac' })).toBe('me@mac');
    });
});

const SETTINGS = {
    recipeOrigin: 'http://localhost:3000',
    identityOrigin: 'http://localhost:3001',
    foodOrigin: 'http://localhost:3002',
};

describe('tunnelsFromManifest', () => {
    const manifest = [
        'platform=ios',
        'recipeOrigin=http://localhost:13000',
        'identityOrigin=http://localhost:13001',
        'foodOrigin=http://localhost:13002',
    ].join('\n');

    it('tunnels each baked origin port back to that service on this machine', () => {
        expect(tunnelsFromManifest(manifest, SETTINGS)).toEqual([
            { macPort: 13000, localPort: 3000 },
            { macPort: 13001, localPort: 3001 },
            { macPort: 13002, localPort: 3002 },
        ]);
    });

    it('tunnels to the host port the local stack really uses, so a moved recipe port reaches the tunnel', () => {
        const moved = { ...SETTINGS, recipeOrigin: 'http://localhost:3010' };
        expect(tunnelsFromManifest(manifest, moved)).toContainEqual({ macPort: 13000, localPort: 3010 });
        expect(tunnelsFromManifest(manifest, moved)).toContainEqual({ macPort: 13001, localPort: 3001 });
    });

    it('refuses a settings origin with no port, because the tunnel could not name the host side', () => {
        expect(() => tunnelsFromManifest(manifest, { ...SETTINGS, foodOrigin: 'http://localhost' })).toThrow(
            /foodOrigin/,
        );
    });

    it('refuses an origin that is not on localhost, because a tunnel cannot reach it', () => {
        expect(() => tunnelsFromManifest(manifest.replace('localhost:13000', 'recipe.example.com'), SETTINGS)).toThrow(
            /recipeOrigin/,
        );
    });

    it('refuses a manifest missing an origin', () => {
        expect(() => tunnelsFromManifest('platform=ios\nrecipeOrigin=http://localhost:13000', SETTINGS)).toThrow(
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
