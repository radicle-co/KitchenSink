/**
 * @module __tests__/mediaDeliveryProps — the media-delivery inputs `DataStack` requires, for suites that build one.
 *
 * `DataStack` takes the apex domain and the upload origins as REQUIRED props (ADR-0064): a default would let a stack
 * synthesize with no CDN and no bucket CORS, which is the defect this exists to close. Suites that only care about the
 * database therefore need *some* valid value; this is the one place that supplies it. The certificate and the zone are
 * not props: `DataStack` reads them from the SSM parameters `DomainStack` writes, so there is nothing to fake.
 *
 * @pattern Factory Method — one construction point for the props, so a new required prop is one edit, not ten
 */
import type { DataStackProps } from '../lib/platform/DataStack.js';

/** The origins a test synth admits to the media bucket's CORS rule. */
export const TEST_UPLOAD_ORIGINS: readonly string[] = ['https://commise.app'];

/**
 * The media-delivery props for a `DataStack`.
 *
 * @param overrides - Props to replace, e.g. an empty `uploadOrigins` for the refusal test.
 * @returns The props to spread into `new DataStack(...)`. Pure.
 */
export function mediaDeliveryProps(
    overrides: Partial<Pick<DataStackProps, 'domainName' | 'uploadOrigins'>> = {},
): Pick<DataStackProps, 'domainName' | 'uploadOrigins'> {
    return {
        domainName: overrides.domainName ?? 'commise.app',
        uploadOrigins: overrides.uploadOrigins ?? TEST_UPLOAD_ORIGINS,
    };
}
