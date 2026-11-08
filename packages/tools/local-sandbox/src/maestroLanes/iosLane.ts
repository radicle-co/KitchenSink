/**
 * The pure facts of an iOS lane on a remote Mac: names, ports, host facts parsed from captured output, the tunnel
 * list read from the test app's manifest, and the ssh config text. No I/O lives here, so the adapter that does the
 * ssh work stays thin and these rules are tested against captured output.
 *
 * @pattern Value-object helpers; the iOS adapter (Strategy behind the DeviceAdapter port) composes them.
 */
import { bytesFromFreePercent, parseFreePercent } from '@kitchensink/e2e-plan/hostMemory';

import type { LocalSettings } from './localSettings.js';

/** iOS lanes are capped by the owner's ruling, not by the Mac. */
export const IOS_MAX_LANES = 5;

/** The origin keys the app manifest and the local settings share. */
const ORIGIN_KEYS = ['recipeOrigin', 'identityOrigin', 'foodOrigin'] as const;

export interface MacHostFacts {
    readonly cpus: number;
    readonly load1: number;
    readonly memAvailable: number;
}

export interface Tunnel {
    /** The manifest and settings key of the origin this tunnel serves. */
    readonly origin: (typeof ORIGIN_KEYS)[number];
    readonly macPort: number;
    readonly localPort: number;
}

function assertLane(lane: number): void {
    if (!Number.isInteger(lane) || lane < 1 || lane > IOS_MAX_LANES) {
        throw new RangeError(`iOS lane ${String(lane)} is outside 1..${String(IOS_MAX_LANES)}`);
    }
}

export function laneSimulatorName(lane: number): string {
    assertLane(lane);

    return `ks-maestro-lane-${String(lane)}`;
}

export function macHostFromEnv(env: Readonly<Record<string, string | undefined>>): string {
    const host = env['LOCAL_MAESTRO_IOS_HOST']?.trim();

    if (host === undefined || host === '') {
        throw new Error('LOCAL_MAESTRO_IOS_HOST is not set; the Mac to drive is never guessed');
    }

    // A host is a name or user@name: a leading dash would be read by ssh as an option, and a space would split it.
    if (!/^[A-Za-z0-9_][A-Za-z0-9._@:%[\]-]*$/u.test(host)) {
        throw new Error(`LOCAL_MAESTRO_IOS_HOST ${JSON.stringify(host)} is not a host name or user@host`);
    }

    return host;
}

function numberAfter(label: string, text: string): number {
    const match = new RegExp(`^${label}\\s+\\{?\\s*([0-9.]+)`, 'm').exec(text);

    if (match?.[1] === undefined) {
        throw new Error(`host facts have no ${label}`);
    }

    return Number(match[1]);
}

/** Parses `laneHost.sh facts` output: `ncpu`, `memsize` and `loadavg` lines and `memory_pressure`'s free-percentage line. */
export function parseHostFacts(output: string): MacHostFacts {
    return {
        cpus: numberAfter('ncpu', output),
        load1: numberAfter('loadavg', output),
        // The one memory rule, in e2e-plan: the kernel's free percentage, with the planner's margin, refusing a read it cannot trust.
        memAvailable: bytesFromFreePercent(numberAfter('memsize', output), parseFreePercent(output)),
    };
}

/**
 * Reads the origins baked into the app (`testApp.manifest`) and returns the reverse tunnels they need. The Mac side is
 * the port the app was built with; the local side is the host port the local stack states in its settings, so a moved
 * service port reaches the tunnel with no second copy of it here.
 */
export function tunnelsFromManifest(
    manifest: string,
    settings: Pick<LocalSettings, (typeof ORIGIN_KEYS)[number]>,
): readonly Tunnel[] {
    const values = new Map<string, string>();

    for (const line of manifest.split('\n')) {
        const at = line.indexOf('=');

        if (at > 0) {
            values.set(line.slice(0, at), line.slice(at + 1).trim());
        }
    }

    return ORIGIN_KEYS.map((key) => {
        const raw = values.get(key);

        if (raw === undefined || raw === '') {
            throw new Error(`the test app manifest has no ${key}`);
        }

        const url = new URL(raw);

        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
            throw new Error(`${key} is ${raw}: a tunnel only serves a localhost origin`);
        }

        const localPort = Number(new URL(settings[key]).port);

        if (!Number.isInteger(localPort) || localPort <= 0) {
            throw new Error(`the local settings ${key} ${settings[key]} names no host port`);
        }

        return { origin: key, macPort: Number(url.port), localPort };
    });
}

export function sshConfigText(options: { readonly host: string; readonly controlPath: string }): string {
    return [
        '# one ssh connection per run, shared by every shim call',
        `# host: ${options.host}`,
        'Host *',
        '    BatchMode yes',
        '    ConnectTimeout 20',
        '    ServerAliveInterval 15',
        '    ServerAliveCountMax 4',
        '    ControlMaster auto',
        `    ControlPath ${options.controlPath}`,
        '    ControlPersist 900',
        '',
    ].join('\n');
}
