/**
 * EVERY MAESTRO `launchApp` NAMES AN EMPTY PERMISSION LIST, `permissions: {}`.
 *
 * With no `permissions`, Maestro uses `all: allow` and applies it on EVERY launch. On the iOS Simulator that is
 * `applesimutils --setPermissions` over a dozen services plus `simctl privacy grant location-always`: 15 to 30 seconds a
 * launch on CI's macOS runners (run 39668114177, iOS shard 3), about three launches a flow, so 10 to 20 minutes of an
 * iOS shard spent before any step. That is what pushed the iOS shards past their 75-minute limit. With an empty list
 * Maestro calls neither tool (measured on the Mac, 2026-10-22: the launch took 0.36 s, against 1.6 s with the default
 * on an idle machine).
 *
 * The app needs no permission in any flow: it asks only for the camera and the photo library, and only when a cook
 * picks a photo source, and no flow hands over to that system screen (`recipes/photos.yaml` says why). A flow that one
 * day needs a permission names that one permission instead.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    REPO_ROOT,
    commandLists,
    committedFlowFiles,
    isLaunch,
    isRecord,
    launchOptions,
    parseFlow,
} from './maestroFlowYaml.js';

/** Launches today: 25 (2026-10-22). A floor, so a parser that saw none cannot pass. */
const MIN_LAUNCHES = 20;

/** Whether a `launchApp` names its permissions explicitly as a map (an empty one, or only what the flow needs). Pure. */
const namesPermissions = (command: unknown): boolean => isRecord(launchOptions(command)['permissions']);

/** Every `launchApp` in one flow that leaves Maestro's default `all: allow` in force. Pure. */
export function launchesOnDefaultPermissions(
    file: string,
    source: string,
): { readonly launches: number; readonly offenders: readonly string[] } {
    const offenders: string[] = [];
    let launches = 0;

    for (const document of parseFlow(file, source)) {
        for (const list of commandLists(document)) {
            for (const command of list) {
                if (!isLaunch(command)) {
                    continue;
                }

                launches += 1;

                if (!namesPermissions(command)) {
                    offenders.push(`${file}: a launchApp names no permissions, so Maestro grants all on every launch`);
                }
            }
        }
    }

    return { launches, offenders };
}

const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('launchesOnDefaultPermissions (the rule, on inline flows)', () => {
    it.each([
        ['a bare launchApp', '- launchApp\n'],
        ['a launchApp with other options only', '- launchApp:\n    clearState: true\n'],
        ['a launchApp whose permissions are not a map', '- launchApp:\n    permissions: all\n'],
        ['a launchApp nested in a runFlow', '- runFlow:\n    commands:\n      - launchApp\n'],
    ])('refuses %s', (_label, body) => {
        expect(launchesOnDefaultPermissions('a.yaml', flow(body)).offenders).toHaveLength(1);
    });

    it.each([
        ['an empty permission list', '- launchApp:\n    permissions: {}\n'],
        ['one named permission', '- launchApp:\n    clearState: true\n    permissions:\n      camera: allow\n'],
    ])('allows %s', (_label, body) => {
        const judged = launchesOnDefaultPermissions('a.yaml', flow(body));

        expect(judged.launches).toBe(1);
        expect(judged.offenders).toEqual([]);
    });
});

describe('the committed flows never leave Maestro granting every permission on a launch', () => {
    const judged = committedFlowFiles().map((file) =>
        launchesOnDefaultPermissions(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
    );

    it('finds the launches', () => {
        expect(judged.reduce((sum, { launches }) => sum + launches, 0)).toBeGreaterThanOrEqual(MIN_LAUNCHES);
    });

    it('every launch names its permissions', () => {
        expect(judged.flatMap(({ offenders }) => offenders)).toEqual([]);
    });
});
