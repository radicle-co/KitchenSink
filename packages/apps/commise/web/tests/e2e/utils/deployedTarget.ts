/**
 * Whether this Playwright run has a DEPLOYED target, for the specs that read a deployed service and may face nothing
 * else.
 *
 * Such a spec skips when the answer is "none" (owner rulings 2026-09-05 and 2026-10-03: a DEPLOYED-target suite skips
 * when its target is absent and is never re-pointed at localhost). The target is `PLAYWRIGHT_BASE_URL`, the variable
 * the deployed tier sets and `playwright.config.ts` reads as `baseURL`, but only when it names a host that is not
 * loopback: `recipeLive.spec.ts` points that same variable at a local dev server, and a local server is not a deploy.
 *
 * Loopback addresses come from `node:net`'s `BlockList` (127.0.0.0/8, ::1) plus the names RFC 6761 reserves for the
 * local host (`localhost` and `*.localhost`) and the unspecified address, which a browser reaches as this machine.
 *
 * Every function in this module is pure.
 */
import { BlockList, isIP } from 'node:net';

/** The variable that names the deployed origin a run drives. */
const TARGET_VARIABLE = 'PLAYWRIGHT_BASE_URL';

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
LOOPBACK.addAddress('0.0.0.0', 'ipv4');
LOOPBACK.addAddress('::', 'ipv6');

/** Raised when `PLAYWRIGHT_BASE_URL` is set to something that is not an absolute http(s) URL. */
export class InvalidDeployedTargetError extends Error {
    public constructor(value: string) {
        super(
            `${TARGET_VARIABLE}='${value}' is not an absolute http(s) URL. It names the deployed origin this run ` +
                'drives; a spec that needs one cannot tell a misconfigured target from an absent one, and must not ' +
                'skip as if nothing were deployed. See tests/e2e/utils/deployedTarget.ts.',
        );
        this.name = 'InvalidDeployedTargetError';
        Object.setPrototypeOf(this, InvalidDeployedTargetError.prototype);
    }
}

/**
 * Type guard for {@link InvalidDeployedTargetError}.
 *
 * @param error - Any thrown value.
 * @returns Whether it is an {@link InvalidDeployedTargetError}.
 */
export function isInvalidDeployedTargetError(error: unknown): error is InvalidDeployedTargetError {
    return error instanceof InvalidDeployedTargetError;
}

/**
 * Whether a URL host is this machine.
 *
 * @param hostname - `URL.hostname`, which keeps an IPv6 literal's brackets.
 * @returns True for a loopback name or address.
 */
function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[(.*)\]$/u, '$1');

    if (host === 'localhost' || host.endsWith('.localhost')) {
        return true;
    }

    const family = isIP(host);

    return family !== 0 && LOOPBACK.check(host, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The deployed origin this run drives, if it has one.
 *
 * @param env - The process environment to read.
 * @returns The origin, or `undefined` when `PLAYWRIGHT_BASE_URL` is unset, blank, or names this machine.
 * @throws {InvalidDeployedTargetError} When `PLAYWRIGHT_BASE_URL` is set but is not an absolute http(s) URL.
 */
export function deployedTargetOrigin(env: Readonly<Record<string, string | undefined>>): string | undefined {
    const configured = env[TARGET_VARIABLE]?.trim() ?? '';

    if (configured === '') {
        return undefined;
    }

    let url: URL;

    try {
        url = new URL(configured);
    } catch {
        throw new InvalidDeployedTargetError(configured);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new InvalidDeployedTargetError(configured);
    }

    return isLoopbackHost(url.hostname) ? undefined : url.origin;
}
