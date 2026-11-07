/**
 * The pure facts of an iOS lane on a remote Mac: names, ports, host facts parsed from captured output, the tunnel
 * list read from the test app's manifest, and the ssh config text. No I/O lives here, so the adapter that does the
 * ssh work stays thin and these rules are tested against captured output.
 *
 * @pattern Value-object helpers; the iOS adapter (Strategy behind the DeviceAdapter port) composes them.
 */

/** iOS lanes are capped by the owner's ruling, not by the Mac. */
export const IOS_MAX_LANES = 5;

/** Which service each baked origin reaches on this machine. One place, mirrors `localMaestro.sh`'s ports. */
const ORIGIN_KEY_TO_LOCAL_PORT = { recipeOrigin: 3000, identityOrigin: 3001, foodOrigin: 3002 } as const;

export interface MacHostFacts {
    readonly cpus: number;
    readonly load1: number;
    readonly memAvailable: number;
}

export interface Tunnel {
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

/** 7000 + lane: below the ephemeral range on both hosts, one port per lane process. */
export function driverPortFor(lane: number): number {
    assertLane(lane);
    return 7000 + lane;
}

export function macHostFromEnv(env: Readonly<Record<string, string | undefined>>): string {
    const host = env['LOCAL_MAESTRO_IOS_HOST']?.trim();
    if (host === undefined || host === '') {
        throw new Error('LOCAL_MAESTRO_IOS_HOST is not set; the Mac to drive is never guessed');
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

function pages(label: string, text: string): number {
    const match = new RegExp(`^Pages ${label}:\\s+([0-9]+)`, 'm').exec(text);
    return match?.[1] === undefined ? 0 : Number(match[1]);
}

/** Parses `laneHost.sh facts` output (`ncpu`, `memsize`, `loadavg` lines, then `vm_stat`). */
export function parseHostFacts(output: string): MacHostFacts {
    const pageSize = /page size of ([0-9]+) bytes/.exec(output)?.[1];
    if (pageSize === undefined) {
        throw new Error('vm_stat output has no page size');
    }
    return {
        cpus: numberAfter('ncpu', output),
        load1: numberAfter('loadavg', output),
        memAvailable:
            (pages('free', output) + pages('inactive', output) + pages('speculative', output)) * Number(pageSize),
    };
}

/** Reads the origins baked into the app (`testApp.manifest`) and returns the reverse tunnels they need. */
export function tunnelsFromManifest(manifest: string): readonly Tunnel[] {
    const values = new Map<string, string>();
    for (const line of manifest.split('\n')) {
        const at = line.indexOf('=');
        if (at > 0) {
            values.set(line.slice(0, at), line.slice(at + 1).trim());
        }
    }
    return (Object.keys(ORIGIN_KEY_TO_LOCAL_PORT) as (keyof typeof ORIGIN_KEY_TO_LOCAL_PORT)[]).map((key) => {
        const raw = values.get(key);
        if (raw === undefined || raw === '') {
            throw new Error(`the test app manifest has no ${key}`);
        }
        const url = new URL(raw);
        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
            throw new Error(`${key} is ${raw}: a tunnel only serves a localhost origin`);
        }
        return { macPort: Number(url.port), localPort: ORIGIN_KEY_TO_LOCAL_PORT[key] };
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
