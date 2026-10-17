/**
 * Records the search gaps one source's answer found (ADR-0055 point 4): counts them under the source's EMF dimension,
 * then upserts them. It runs after the source's frame is written, and a failure is logged and never reaches the search.
 *
 * @module
 */
import { Logger } from '@nestjs/common';
import type { RemoteSearchSource } from '@kitchensink/schema-remote-search';

import type { FoodMetrics } from '../observability/emfMetrics.js';
import type { SearchGapDao } from './dao/searchGap.dao.js';
import type { SearchGap } from './domain/remoteHitTriage.js';

/** Where a failed record is reported. Nest's `Logger` satisfies it. */
export interface GapRecorderLogger {
    error(message: string, context?: Record<string, unknown>): void;
}

export class SearchGapRecorder {
    /**
     * @param store - The gap store.
     * @param metrics - Where the count goes.
     * @param logger - Where a failure goes. Defaults to a Nest `Logger`.
     */
    public constructor(
        private readonly store: Pick<SearchGapDao, 'record'>,
        private readonly metrics: Pick<FoodMetrics, 'recordSearchGaps'>,
        private readonly logger: GapRecorderLogger = new Logger(SearchGapRecorder.name),
    ) {}

    /**
     * Count and store one source's gaps. Never rejects.
     *
     * @param source - The source the gaps came from.
     * @param gaps - The gaps, one per key.
     * @sideEffect Emits an EMF metric and upserts `search_gap`; logs a failure.
     */
    public async record(source: RemoteSearchSource, gaps: readonly SearchGap[]): Promise<void> {
        if (gaps.length === 0) {
            return;
        }

        this.metrics.recordSearchGaps(source, gaps.length);

        try {
            await this.store.record(gaps);
        } catch (error) {
            this.logger.error('search-gap-record-failed', { source, gaps: gaps.length, cause: String(error) });
        }
    }
}
