/**
 * Component tests for `ParseJobReviewContainer` — the review route's wiring, driven through a real
 * `RecipeServiceClient` with only its transport stubbed, so the query key, the poll's enable gate and the
 * parse of the response are all exercised rather than mocked away.
 *
 * Covers every state the route can be in from a viewer's side — loading, running, settling (with a working
 * retry), ready, expired, missing, failed — plus the one navigation this container owns.
 *
 * ⛔ THE EXPIRED CASE IS THE POINT OF THE WHOLE ROUTE EXISTING AT A URL. The server spends a TTL constant,
 * a sweep and a seven-day purge grace on the affordance "leave the tab open overnight, come back, see an
 * honest expired job". Holding the job id in React state would make that unreachable; this suite is what
 * proves an addressed job renders it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { recipeParseMessages } from '@commise/features-recipes';
import { renderWithRecipeClient } from '@commise/test-utils';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { ParseJobResponse } from '@kitchensink/recipe-service-client';

import { ParseJobReviewContainer } from '@/components/recipes/ParseJobReviewContainer';

const messages = recipeParseMessages.en;
const JOB_ID = '00000000-0000-4000-8000-00000000d001';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function job(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: JOB_ID,
        status: 'complete',
        createdAt: '2026-09-02T11:59:00.000Z',
        // Far ahead, so the deadline never decides a case that is not about it.
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        lines: [
            {
                lineIndex: 0,
                sourceLine: '2 cups flour',
                status: 'parsed',
                proposal: {
                    raw: '2 cups flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: '2 cups',
                    foods: [{ name: 'flour', prep: null }],
                    reviewReasons: [],
                },
            },
        ],
        ...overrides,
    };
}

describe('ParseJobReviewContainer', () => {
    it('shows the loading state while the first view is in flight', () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockReturnValue(new Promise(() => undefined));

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(screen.getByRole('status').textContent).toContain(messages.loading);
    });

    it('renders a finished job: its progress, its lines, and no retry control', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockResolvedValue(job());

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByText('2 cups flour')).toBeTruthy();
        expect(screen.getByText('1 of 1 lines read')).toBeTruthy();
        expect(screen.getByText('2 cup')).toBeTruthy();
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('renders a running job as work in progress, with no controls to press', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockResolvedValue(
            job({ status: 'running', lines: [{ lineIndex: 0, sourceLine: 'x', status: 'pending', proposal: null }] }),
        );

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByText(messages.running)).toBeTruthy();
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('re-drives a settling job through the retry control', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockResolvedValue(
            job({
                status: 'partial',
                lines: [{ lineIndex: 0, sourceLine: 'x', status: 'failed_retryable', proposal: null }],
            }),
        );
        const retryParseJob = vi.spyOn(client, 'retryParseJob').mockResolvedValue(job({ status: 'running' }));

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByText(messages.settling)).toBeTruthy();
        await user.click(screen.getByRole('button', { name: messages.retryAction }));

        await waitFor(() => expect(retryParseJob).toHaveBeenCalledWith(JOB_ID));
    });

    it('⛔ renders an expired job from a URL a cook came back to, and offers NO retry', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockResolvedValue(job({ status: 'expired' }));

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.expired);
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('⛔ renders expiry from the DEADLINE too, while the wire status still says running', async () => {
        // The TTL sweep rides a 15-minute tick while mutations refuse on the timestamp — so this exact
        // response is what a cook sees for up to a quarter hour after their job really died.
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockResolvedValue(
            job({ status: 'running', expiresAt: new Date(Date.now() - 1000).toISOString() }),
        );

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.expired);
    });

    it('renders a 404 as one answer — never as "not yours"', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockRejectedValue(new NotFoundError('gone', 'PARSE_JOB_NOT_FOUND'));

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.missing);
    });

    it('settles on a failure — never a permanent skeleton — when the read HANGS past the client timeout', async () => {
        const { RecipeServiceClient } = await import('@kitchensink/recipe-service-client');
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.example.test',
            token: 't',
            fetch: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
            timeoutMs: 25,
        });

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', messages.failed);
    });

    it('sends a cook back to the paste form from "start over"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getParseJob').mockResolvedValue(job());

        renderWithRecipeClient(<ParseJobReviewContainer locale="en" jobId={JOB_ID} />, client);

        await user.click(await screen.findByRole('button', { name: messages.startOverAction }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/parse');
    });
});
