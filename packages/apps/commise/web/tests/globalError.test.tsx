import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

import GlobalError from '@/app/global-error';

describe('GlobalError', () => {
    it('reports the error to Sentry on mount', () => {
        const error = new Error('boom');

        render(<GlobalError error={error} />);

        expect(mockCaptureException).toHaveBeenCalledWith(error);
    });
});
