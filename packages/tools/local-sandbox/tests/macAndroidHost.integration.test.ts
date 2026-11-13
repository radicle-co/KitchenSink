/**
 * Integration tier: the Mac Android host over a REAL `MacSession` and a scripted shell. The session-open contract lives
 * here, because it is a contract between the host and the session: the lane run asks for a lane's environment while it
 * provisions the lane's users, before `prepare` has opened the session, and asks again when it starts the runner. The
 * host's other behaviour is covered by `src/maestroLanes/__tests__/macAndroidHost.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { APK_PATH, makeLane, makeMacAndroidRig, makeRun } from '../src/maestroLanes/__fixtures__/macAndroidHostRig.js';

const lane = makeLane();
const run = makeRun();

describe('MacAndroidHost lane environment and the session', () => {
    it('answers an empty environment, and does not throw, before the session is open', () => {
        const { host } = makeMacAndroidRig();

        expect(() => host.laneEnv(lane)).not.toThrow();
        expect(host.laneEnv(lane)).toEqual({});
    });

    it('gives the runner the lane device, the Mac SDK, the shims first on PATH, the APK and the Mac recipe tunnel port once it is open', async () => {
        const { host } = makeMacAndroidRig();
        await host.prepare(run, APK_PATH, 'abc123');
        const env = host.laneEnv(lane);

        expect(env['ANDROID_SERIAL']).toBe('emulator-5556');
        expect(env['MAESTRO_ANDROID_APK']).toBe(APK_PATH);
        expect(env['MAESTRO_SKIP_INSTALL']).toBe('1');
        expect(env['MAESTRO_LOCAL_RECIPE_HOST_PORT']).toBe('14000');
        expect(env['KS_MAC_ANDROID_HOME']).toBe('/Users/x/ksAndroid/sdk');
        expect(env['KS_MAC_ANDROID_ENV']).toBe('/Users/x/ksAndroid/env.sh');
        expect(env['PATH']?.startsWith('/s/shims:')).toBe(true);
        expect(env['KS_MAC_LANE_HOME']).toBe('/Users/x/ksIos/lanes/lane1');
    });
});
