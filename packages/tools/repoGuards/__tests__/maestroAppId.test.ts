// @vitest-environment node
/**
 * Repo-wide guard: a Maestro run drives the app by the ID of THIS platform's build, and no flow states an ID.
 *
 * ## The defect class this pins
 *
 * The iOS bundle ID (`com.radicle-co.commise`, the App ID registered with Apple) and the Android package
 * (`io.commise.mobile`) differ, but every flow's header said `appId: io.commise.mobile` for both platforms. On the
 * Simulator `launchApp` then names an app that is not installed. The fix is one variable, `APP_ID`, and this file
 * holds all three places that must agree:
 *
 *   - every flow (and sub-flow) header reads `appId: ${APP_ID}` and states no literal ID;
 *   - `runMaestroFlows.sh` answers each platform's ID, and those equal the constants `app.config.ts` writes into the
 *     build (`IOS_BUNDLE_IDENTIFIER`, `ANDROID_PACKAGE`), so the installed app and the launched app cannot differ;
 *   - the `maestro test` command line passes `-e "APP_ID=<that answer>"`, so a flow can never run without it.
 *
 * `app.config.ts` is read as text because the config loader cannot be imported across the workspace boundary.
 *
 * Mutation evidence: written before the script had `app-id` (the spawn reported its usage error) and while every
 * flow still carried the literal Android package.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MOBILE = join(REPO_ROOT, 'packages/apps/commise/mobile');
const SCRIPT = join(MOBILE, 'tests/e2e/runMaestroFlows.sh');
const MAESTRO_DIR = join(MOBILE, '.maestro');

/** The string literal a top-level `export const <name> = '…';` declares in `app.config.ts`. */
function configConstant(name: string): string {
    const source = readFileSync(join(MOBILE, 'app.config.ts'), 'utf8');
    const match = new RegExp(`^export const ${name} = '([^']+)';$`, 'mu').exec(source);

    if (match?.[1] === undefined) {
        throw new Error(`app.config.ts declares no \`export const ${name} = '…';\``);
    }

    return match[1];
}

function appIdFor(platform: string): { readonly status: number | null; readonly stdout: string } {
    const result = spawnSync('bash', [SCRIPT, 'app-id', platform], { encoding: 'utf8' });

    return { status: result.status, stdout: result.stdout.trim() };
}

function flowFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) {
            return flowFiles(join(dir, entry.name));
        }

        return entry.name.endsWith('.yaml') ? [join(dir, entry.name)] : [];
    });
}

describe('the app ID a Maestro run drives', () => {
    it('is the iOS bundle ID on iOS and the Android package on Android, as app.config.ts builds them', () => {
        expect(appIdFor('ios')).toEqual({ status: 0, stdout: configConstant('IOS_BUNDLE_IDENTIFIER') });
        expect(appIdFor('android')).toEqual({ status: 0, stdout: configConstant('ANDROID_PACKAGE') });
    });

    it('keeps the two IDs distinct (a copy-paste of one into the other is the defect)', () => {
        expect(appIdFor('ios').stdout).not.toBe(appIdFor('android').stdout);
    });

    it('refuses a platform it does not know rather than guessing', () => {
        expect(appIdFor('windows').status).not.toBe(0);
    });

    it('is passed to every `maestro test` as -e APP_ID', () => {
        const script = readFileSync(SCRIPT, 'utf8');
        const testLines = script
            .split('\n')
            .filter((line) => line.includes('--driver-host-port') && !/^\s*#/u.test(line));

        expect(testLines.length).toBeGreaterThan(0);

        for (const line of testLines) {
            expect(line).toContain('-e "APP_ID=');
        }
    });
});

describe('every Maestro flow header', () => {
    const flows = flowFiles(MAESTRO_DIR);

    it('finds the committed flows', () => {
        expect(flows.length).toBeGreaterThan(50);
    });

    it.each(flows.map((file) => [file.slice(MAESTRO_DIR.length + 1), file] as const))(
        '%s takes the app ID from APP_ID',
        (_name, file) => {
            const source = readFileSync(file, 'utf8');

            if (/^appId:/mu.test(source)) {
                expect(source).toMatch(/^appId: \$\{APP_ID\}$/mu);
            }

            expect(source).not.toMatch(/io\.commise\.mobile|com\.radicle-co\.commise/u);
        },
    );
});
