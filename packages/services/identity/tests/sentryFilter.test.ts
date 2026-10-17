import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { shouldCaptureException } from '../src/observability/sentry.filter.js';

describe('shouldCaptureException', () => {
    it('captures unexpected (non-HTTP) exceptions (AE2)', () => {
        expect(shouldCaptureException(new Error('boom'))).toBe(true);
        expect(shouldCaptureException(new TypeError('bad'))).toBe(true);
        expect(shouldCaptureException('string failure')).toBe(true);
    });

    it('does not capture HttpException control flow', () => {
        expect(shouldCaptureException(new NotFoundException())).toBe(false);
        expect(shouldCaptureException(new BadRequestException())).toBe(false);
        expect(shouldCaptureException(new HttpException('teapot', 418))).toBe(false);
    });
});
