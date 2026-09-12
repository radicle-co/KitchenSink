import type { Context } from 'aws-lambda';

/** @implements REQ-IF-006 NFR-012 NFR-013 NFR-014 NFR-016 NFR-017 ARCH-027 ARCH-028 ARCH-029 MOD-027 MOD-028 MOD-029 */
export const resolveRequestId = (context: Context, candidate?: string | undefined): string => {
    if (candidate && candidate.length > 0) {
        return candidate;
    }

    return context.awsRequestId;
};
