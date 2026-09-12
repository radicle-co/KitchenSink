/**
 * ⛔ THE ACCEPTANCE CRITERION for the Maestro driver port — an invariant whose whole value is the RANGE it
 * sits outside of, which is exactly the part a well-meaning edit would not know to preserve.
 *
 * ## The defect, proven from Maestro's own source (`cli-2.6.1`, the pinned CI version)
 *
 * `TestCommand.selectPort()` asks the HOST for a free port — `ServerSocket(0).use { it.localPort }`, carrying
 * the comment *"Let the OS pick an available port. ServerSocket(0) guarantees no collision"* — and then
 * IMPOSES that number on the DEVICE: `am instrument … -e port $port`, where `MaestroDriverService` does
 * `NettyServerBuilder.forPort(port).start()`. The guarantee is real on the host and meaningless on the
 * emulator: two machines, two independent sets of bound ports. When the number is already taken on the
 * device the driver throws `BindException: Address already in use` and there is NO retry and NO fallback —
 * the flow simply dies. This is unchanged in 2.7.0 and 2.8.0, so upgrading does not fix it.
 *
 * It fired once, on `recipes/discover-clone` (run 32182061356):
 *
 *     E TestRunner: java.io.IOException: Failed to bind to address ::/[::]:35579
 *     E TestRunner: Caused by: java.net.BindException: Address already in use
 *
 * ## Why a STATIC port fixes it, and why the specific number matters
 *
 * Linux hands out ephemeral ports from `ip_local_port_range` (32768–60999 by default) — that is the pool a
 * bare `bind(0)` or an outbound `connect()` draws from. Every one of the 26 ports Maestro chose in that run
 * was inside it. Pinning the driver to a port BELOW that range means the kernel can never hand it to anything
 * else by chance, which removes the entire collision class rather than making it rarer.
 *
 * So the assertion here is not "the port equals 7001" — it is "the port is outside the range the kernel
 * allocates from". A future edit that moves it to, say, 40000 would look harmless, keep every test passing
 * that merely checks a number was configured, and silently restore the bug.
 *
 * ## Why STATIC is safe here, when it would not be in general
 *
 * A fixed port is only safe because the runner now tears the driver down before every flow. Without that, a
 * leaked driver would hold the fixed port and turn a 1-in-188 flake into a deterministic failure for every
 * subsequent flow — strictly worse than the random scheme. The teardown is asserted by
 * `tests/maestroDriverLifecycle.integration.test.ts`; the two changes are a pair and neither is correct alone.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/run-maestro-flows.sh');

/**
 * Linux's default `net.ipv4.ip_local_port_range`. The kernel draws ephemeral ports from here for both
 * `bind(0)` and outbound `connect()`, so this is precisely the window the driver port must avoid.
 */
const EPHEMERAL_LOW = 32768;
const EPHEMERAL_HIGH = 60999;

/**
 * Run the script's `driver-port` subcommand.
 *
 * @returns The port it prints.
 * @sideEffect Spawns `bash`. Touches no device and no network.
 */
function driverPort(): number {
    const result = spawnSync('bash', [SCRIPT, 'driver-port'], { encoding: 'utf8' });

    expect(result.status, `driver-port exited ${result.status}: ${result.stderr}`).toBe(0);

    return Number(result.stdout.trim());
}

describe('maestro driver port', () => {
    it('⛔ sits OUTSIDE the kernel ephemeral range — the property that removes the collision', () => {
        // THE assertion. Inside this window the kernel can hand the same number to some other socket on the
        // device, which is exactly what killed `recipes/discover-clone`.
        const port = driverPort();

        expect(
            port < EPHEMERAL_LOW || port > EPHEMERAL_HIGH,
            `driver port ${port} is inside the ephemeral range ${EPHEMERAL_LOW}-${EPHEMERAL_HIGH}, so the ` +
                'kernel can assign it to another socket on the device and the driver will fail to bind',
        ).toBe(true);
    });

    it('is a usable, non-privileged TCP port', () => {
        const port = driverPort();

        expect(Number.isInteger(port)).toBe(true);
        // Below 1024 needs root to bind; above 65535 is not a port.
        expect(port).toBeGreaterThan(1023);
        expect(port).toBeLessThan(65536);
    });

    it('⛔ is STATIC — the same on every invocation', () => {
        // A port that varied per call would reintroduce the draw-a-random-number behaviour this replaces,
        // and would also break the teardown pairing (you cannot reliably free a port you cannot predict).
        expect(driverPort()).toBe(driverPort());
    });
});
