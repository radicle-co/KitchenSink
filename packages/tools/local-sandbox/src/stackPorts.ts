/**
 * @module stackPorts — the one home of the local stack's port, project and image rules.
 *
 * `LOCAL_SANDBOX_PORT=<P>` is the host port of the recipe service. Unset, empty or `3000` is today's stack. Any other
 * value shifts every default host port by the same offset (k = P - 3000) and puts the stack under its own Docker
 * project, container names and image tags, so it runs beside the default stack and shares no Docker state with it.
 *
 * This module also owns the two ownership predicates over Compose labels, the volume owner verdict, the one refusal
 * line every door prints and the one `stack:` status line. All of it is pure: a door reads Docker and the file system
 * and passes the facts in.
 *
 * @pattern Value Object built by a Smart Constructor — `stackFrom` parses the environment, so a `Stack` that exists is
 *     valid, and no caller validates a port again.
 */
import path from 'node:path';

import { hostPortOverridesFrom } from './localImages.js';

/** The environment variable that selects the stack. */
const PORT_VARIABLE = 'LOCAL_SANDBOX_PORT';

/** The recipe service's default host port: the value of `LOCAL_SANDBOX_PORT` that means "today's stack". */
const DEFAULT_PORT = 3000;

/** The Docker project of the default stack. A shifted stack is `local-sandbox-<P>`. */
const DEFAULT_PROJECT = 'local-sandbox';

/** Today's five published host ports, by compose service name. A shifted stack moves each by the same offset. */
export const DEFAULT_PORTS: readonly (readonly [string, number])[] = [
    ['recipes', 3000],
    ['identity', 3001],
    ['food', 3002],
    ['localstack', 4566],
    ['postgres', 5432],
];

/** Ports a shifted stack must not land on, with who uses each. Metro, adb and the Android emulator range. */
const RESERVED_RANGES: readonly { readonly from: number; readonly to: number; readonly user: string }[] = [
    { from: 5037, to: 5037, user: 'adb' },
    { from: 5554, to: 5585, user: 'the Android emulators' },
    { from: 8081, to: 8081, user: 'Metro' },
];

/** The user of a reserved port, if the port is reserved. The default stack's own ports are reserved too. */
function reservedUserOf(port: number): string | undefined {
    const own = DEFAULT_PORTS.find(([, defaultPort]) => defaultPort === port);

    if (own !== undefined) {
        return `the default stack's ${own[0]}`;
    }

    return RESERVED_RANGES.find((range) => port >= range.from && port <= range.to)?.user;
}

/** One line a door prints for a refusal, in four parts: the door, what it refused, why, and the fix. Pure. */
export function refusalLine(door: string, refused: string, why: string, fix: string): string {
    return `${door} refused: ${refused} ${why}. ${fix}`;
}

/** The status line the Maestro doors print first: which stack they act on. Pure. */
export function stackLine(
    project: string,
    ports: { readonly recipes: number; readonly identity: number; readonly food: number },
    checkout: string,
): string {
    const served = [
        `recipes ${String(ports.recipes)}`,
        `identity ${String(ports.identity)}`,
        `food ${String(ports.food)}`,
    ];

    return `stack: ${project} (${served.join(', ')}) from ${checkout}`;
}

/** The value of `LOCAL_SANDBOX_PORT` the stack cannot use. It carries the three parts a door puts in its refusal. */
export class InvalidStackPortError extends Error {
    /** What was refused, as the door prints it. */
    readonly refused: string;
    /** Why, as a clause that continues "<refused> ...". */
    readonly why: string;
    /** What the developer can do. */
    readonly fix: string;

    public constructor(refused: string, why: string, fix: string) {
        super(`${refused} ${why}. ${fix}`);
        this.name = 'InvalidStackPortError';
        this.refused = refused;
        this.why = why;
        this.fix = fix;
        Object.setPrototypeOf(this, InvalidStackPortError.prototype);
    }
}

/** Whether a value is an {@link InvalidStackPortError}. */
export function isInvalidStackPortError(value: unknown): value is InvalidStackPortError {
    return value instanceof InvalidStackPortError;
}

const FIX = 'Pick another value (3100 works).';

/** The stack a run acts on. Build it with {@link stackFrom}. */
export interface Stack {
    /** The recipe service's host port (`LOCAL_SANDBOX_PORT`, or 3000). */
    readonly port: number;
    /** The shift applied to every default host port. */
    readonly offset: number;
    /** Whether this is today's stack: unset, empty or 3000. */
    readonly isDefault: boolean;
    /** The Docker Compose project. */
    readonly project: string;
    /** The container name of a compose service: `<project>-<service>`. */
    readonly containerName: (service: string) => string;
    /** The local image tag of a repository. A shifted stack has its own tag, so a build never replaces another's. */
    readonly imageTag: (repository: string) => string;
    /**
     * The host port a service publishes on. An entry of `LOCAL_SANDBOX_HOST_PORTS` beats the shift, and the shift
     * beats the default.
     */
    readonly hostPort: (service: string, defaultPort: number) => number;
}

/** The clash text for one moved port, or `undefined` when it is fine. */
function clashOf(service: string, moved: number): string | undefined {
    if (moved < 1024) {
        return `${service} to ${String(moved)}, a port below 1024`;
    }

    if (moved > 65_535) {
        return `${service} to ${String(moved)}, a port above 65535`;
    }

    const user = reservedUserOf(moved);

    return user === undefined ? undefined : `${service} to ${String(moved)}, which ${user} uses`;
}

/** The clauses of every default port that a shift by `offset` would put somewhere it must not go. */
function clashesFor(offset: number): readonly string[] {
    return DEFAULT_PORTS.flatMap(([service, defaultPort]) => clashOf(service, defaultPort + offset) ?? []);
}

/**
 * Parse the environment into the stack a run acts on.
 *
 * @param env - The process environment (`LOCAL_SANDBOX_PORT`, `LOCAL_SANDBOX_HOST_PORTS`).
 * @returns The stack. Unset, empty and `3000` give today's stack. Pure.
 * @throws {InvalidStackPortError} When the value is not a whole port, or moves a default port below 1024, above 65535
 *   or onto a port the default stack, Metro, adb or an Android emulator uses. One error names every clash.
 */
export function stackFrom(env: Readonly<Record<string, string | undefined>>): Stack {
    const raw = env[PORT_VARIABLE];
    const value = raw === undefined || raw === '' ? String(DEFAULT_PORT) : raw;
    const shown = `${PORT_VARIABLE}=${value === value.trim() ? value : JSON.stringify(value)}`;

    if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
        throw new InvalidStackPortError(
            shown,
            'is not a whole number of digits (no sign, decimal point, space or leading zero)',
            FIX,
        );
    }

    const port = Number(value);
    const offset = port - DEFAULT_PORT;
    const isDefault = offset === 0;
    const clashes = isDefault ? [] : clashesFor(offset);

    if (clashes.length > 0) {
        const last = clashes[clashes.length - 1];
        const why =
            clashes.length === 1
                ? `moves ${clashes[0] ?? ''}`
                : `moves ${clashes.slice(0, -1).join(', ')}, and ${last ?? ''}`;

        throw new InvalidStackPortError(shown, why, FIX);
    }

    const overrides = hostPortOverridesFrom(env['LOCAL_SANDBOX_HOST_PORTS']);
    const project = isDefault ? DEFAULT_PROJECT : `${DEFAULT_PROJECT}-${value}`;

    return {
        port,
        offset,
        isDefault,
        project,
        containerName: (service) => `${project}-${service}`,
        imageTag: (repository) => `local-sandbox/${repository}:${isDefault ? 'local' : `local-${value}`}`,
        hostPort: (service, defaultPort) => overrides[service] ?? defaultPort + offset,
    };
}

/**
 * Move a host-side address onto the ports the running stack publishes. An address inside the Docker network
 * (`localstack:4566`) is left alone, because each project has its own network.
 *
 * @param url - A URL or address that names `localhost` or `127.0.0.1` and a container port.
 * @param published - The published host port of each container port, for example `{ 4566: 4666, 5432: 5532 }`.
 * @returns The address with the host port. Pure.
 */
export function onPublishedPorts(url: string, published: Readonly<Record<number, number>>): string {
    return url.replace(/\b(localhost|127\.0\.0\.1):(\d+)/gu, (whole, host: string, port: string) => {
        const moved = published[Number(port)];

        return moved === undefined ? whole : `${host}:${String(moved)}`;
    });
}

/** One Compose container, as far as ownership goes: its project and the working dir Compose recorded. */
export interface ComposeContainer {
    /** The `com.docker.compose.project` label. */
    readonly project: string;
    /** The `com.docker.compose.project.working_dir` label: `<checkout>/.local-sandbox`. */
    readonly workingDir: string;
}

/** The checkout a container was started from: the parent of the generated folder, after `canon`. */
function checkoutOf(container: ComposeContainer, canon: (value: string) => string): string {
    return canon(path.dirname(container.workingDir));
}

/**
 * Every checkout that runs a container of the target project, sorted and without repeats. The owner is this whole set,
 * never the first container Docker lists: a project can be mixed (five containers from one checkout and one from
 * another), and a first-container read would then decide by Docker's list order.
 *
 * @param containers - Every Compose container, stopped ones included.
 * @param project - The target project.
 * @param canon - Resolves a path to its real path (`realpath`), so a symlinked checkout is the same checkout.
 * @returns The checkouts, empty when the project has no container. Pure.
 */
export function targetOwners(
    containers: readonly ComposeContainer[],
    project: string,
    canon: (value: string) => string,
): readonly string[] {
    const owners = containers
        .filter((container) => container.project === project)
        .map((container) => checkoutOf(container, canon));

    return [...new Set(owners)].sort();
}

/**
 * A project this checkout runs other than the target, if any. The door refuses when there is one.
 *
 * @param containers - Every Compose container, stopped ones included.
 * @param checkout - This checkout.
 * @param project - The target project.
 * @param canon - Resolves a path to its real path.
 * @returns The other project, or `undefined`. Pure.
 */
export function checkoutProject(
    containers: readonly ComposeContainer[],
    checkout: string,
    project: string,
    canon: (value: string) => string,
): string | undefined {
    const here = canon(checkout);

    return containers.find((container) => container.project !== project && checkoutOf(container, canon) === here)
        ?.project;
}

/** What {@link volumeOwnerVerdict} reads. */
export interface VolumeOwnerInput {
    /** Whether the project's Postgres volume exists. */
    readonly volumeExists: boolean;
    /** The checkout the owner record names, if the record exists. */
    readonly record: string | undefined;
    /** Every container of the target project, stopped ones included. */
    readonly containers: readonly ComposeContainer[];
    /** This checkout. */
    readonly checkout: string;
    /** Resolves a path to its real path. */
    readonly canon: (value: string) => string;
}

/** The verdict: fine, or refused with the checkout that owns the data (`undefined` when nothing names one). */
export type VolumeOwnerVerdict = { readonly ok: true } | { readonly ok: false; readonly owner: string | undefined };

/**
 * Whether this checkout may start a project whose data may belong to another checkout. A live label beats the owner
 * record, and only the label or the record counts: an old `compose.yml` proves nothing. Pure.
 *
 * @param input - The facts.
 * @returns `ok`, or the refusal with the owner, if one is named.
 */
export function volumeOwnerVerdict(input: VolumeOwnerInput): VolumeOwnerVerdict {
    if (!input.volumeExists) {
        return { ok: true };
    }

    const here = input.canon(input.checkout);
    const owners = targetOwners(input.containers, input.containers[0]?.project ?? '', input.canon);
    const named = owners.length === 0 ? (input.record === undefined ? [] : [input.canon(input.record)]) : owners;

    if (named.length === 0) {
        return { ok: false, owner: undefined };
    }

    return named.length === 1 && named[0] === here ? { ok: true } : { ok: false, owner: named.join(', ') };
}

/**
 * The host port in the output of `docker port <container> <port>`, which is how a door learns the port a running
 * stack publishes (it does not recompute it from the environment).
 *
 * @param output - stdout of `docker port`, one `address:port` mapping per line.
 * @returns The host port of the first mapping, or `undefined` when there is none. Pure.
 */
export function publishedHostPort(output: string): number | undefined {
    const matched = /:(\d+)\s*$/mu.exec(output.trim().split('\n')[0] ?? '');

    return matched?.[1] === undefined ? undefined : Number(matched[1]);
}

/** What {@link labelRefusal} reads. Every fact is passed in: a door reads Docker. */
export interface LabelRefusalInput {
    /** The door that refuses, for example `local:up`. */
    readonly door: string;
    /** The target project. */
    readonly project: string;
    /** This checkout. */
    readonly checkout: string;
    /** Every Compose container on the host, stopped ones included (`docker ps -a`). */
    readonly containers: readonly ComposeContainer[];
    /** Resolves a path to its real path. */
    readonly canon: (value: string) => string;
    /** The fix line for each case, chosen by the caller because each door has its own next step. */
    readonly fixes: {
        /** Another checkout runs the target project. */
        readonly foreign: string;
        /** This checkout already runs a different project. */
        readonly sibling: string;
    };
}

/**
 * The refusal, as one R9 line, when this checkout may not act on the target project because another checkout runs it,
 * or because this checkout already runs a different project (the generated folder holds one stack). A stopped container
 * counts. `undefined` means go ahead. Pure.
 *
 * @param input - The facts.
 * @returns The line, or `undefined`.
 */
export function labelRefusal(input: LabelRefusalInput): string | undefined {
    const { door, project, checkout, containers, canon, fixes } = input;
    const owners = targetOwners(containers, project, canon);

    if (owners.length > 1) {
        return refusalLine(
            door,
            `project ${project}`,
            `runs from more than one checkout: ${owners.join(', ')}`,
            `Run \`docker compose -p ${project} down\` by hand once the owners agree.`,
        );
    }

    const [owner] = owners;

    if (owner !== undefined && owner !== canon(checkout)) {
        return refusalLine(door, `project ${project}`, `runs from ${owner}, not this checkout`, fixes.foreign);
    }

    const other = checkoutProject(containers, checkout, project, canon);

    return other === undefined
        ? undefined
        : refusalLine(
              door,
              'this checkout',
              `already runs project ${other}, and its generated folder holds one stack`,
              fixes.sibling,
          );
}

/** What {@link volumeRefusal} reads. */
export interface VolumeRefusalInput {
    /** The door that refuses. */
    readonly door: string;
    /** The target project. */
    readonly project: string;
    /** This checkout. */
    readonly checkout: string;
    /** Every Compose container on the host, stopped ones included. */
    readonly containers: readonly ComposeContainer[];
    /** Whether the target project's Postgres volume exists. */
    readonly volumeExists: boolean;
    /** The checkout the owner record names, if the record exists. */
    readonly record: string | undefined;
    /** The owner record's path, for the fix line. */
    readonly recordFile: string;
    /** Resolves a path to its real path. */
    readonly canon: (value: string) => string;
}

/**
 * The refusal, as one R9 line, when the project's data volume belongs to another checkout, or to nobody that can be
 * named. A live label beats the owner record. Only `local:up` reads this: it is the one door that writes the record.
 * Pure.
 *
 * @param input - The facts.
 * @returns The line, or `undefined`.
 */
export function volumeRefusal(input: VolumeRefusalInput): string | undefined {
    const verdict = volumeOwnerVerdict({
        volumeExists: input.volumeExists,
        record: input.record,
        containers: input.containers.filter((container) => container.project === input.project),
        checkout: input.checkout,
        canon: input.canon,
    });

    if (verdict.ok) {
        return undefined;
    }

    const volume = `${input.project}_local-sandbox-pgdata`;

    return verdict.owner === undefined
        ? refusalLine(
              input.door,
              `volume ${volume}`,
              'holds Postgres data and nothing names its owner',
              `If it is this checkout's, write this checkout's path into ${input.recordFile}, or remove the volume.`,
          )
        : refusalLine(
              input.door,
              `volume ${volume}`,
              `holds Postgres data owned by ${verdict.owner}, not this checkout`,
              'Start the project there, or remove the volume.',
          );
}

/** A Docker read that failed. The answer to a failed read is a refusal: it is never "nothing is there". */
export class DockerReadError extends Error {
    /** The command that failed, for example `docker ps -a`. */
    readonly command: string;
    /** What Docker said, trimmed. */
    readonly detail: string;

    public constructor(command: string, detail: string) {
        super(`${command} failed (${detail})`);
        this.name = 'DockerReadError';
        this.command = command;
        this.detail = detail;
        Object.setPrototypeOf(this, DockerReadError.prototype);
    }
}

/** Whether a value is a {@link DockerReadError}. */
export function isDockerReadError(value: unknown): value is DockerReadError {
    return value instanceof DockerReadError;
}

/**
 * The refusal line for a failed Docker read. Pure.
 *
 * @param door - The door that refuses.
 * @param error - The failed read.
 * @returns One R9 line.
 */
export function dockerReadRefusal(door: string, error: DockerReadError): string {
    return refusalLine(
        door,
        error.command,
        `failed (${error.detail})`,
        `Start Docker, or fix it, then run ${door} again.`,
    );
}

/**
 * The Compose containers in `docker ps -a --format '{{.Label "com.docker.compose.project"}}<TAB>{{.Label
 * "com.docker.compose.project.working_dir"}}'` output. A line without both labels names no checkout and is skipped.
 *
 * @param output - stdout of that command, one container per line.
 * @returns The containers. Pure.
 */
export function composeContainersFrom(output: string): readonly ComposeContainer[] {
    return output.split('\n').flatMap((line) => {
        const [project, workingDir] = line.split('\t');

        return project === undefined || project === '' || workingDir === undefined || workingDir === ''
            ? []
            : [{ project, workingDir }];
    });
}
