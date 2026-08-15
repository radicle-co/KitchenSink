/**
 * `SilentWorkerLogger` — a {@link WorkerLogger} that drops every record.
 *
 * The test default: a consumer under test still gets a real logger (so a missing-logger crash would
 * surface) while the suite's output stays readable.
 */
import type { WorkerLogger } from './workerLogger.js';

export class SilentWorkerLogger implements WorkerLogger {
    /** @inheritdoc */
    public info(): void {}
    /** @inheritdoc */
    public warn(): void {}
    /** @inheritdoc */
    public error(): void {}
}
