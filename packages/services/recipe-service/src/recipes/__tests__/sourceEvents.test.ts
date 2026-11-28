/**
 * The source lock's three log events (plan everyAnswerSourceLock KTD-11, ADR-0100): each is one EMF line dimensioned by `Stage`
 * alone, and none carries an answer, a citation, a link or a reason (qse Q-3).
 */
import { SOURCE_EVENT_NAMESPACE } from '@kitchensink/recipe-core/source-event-names';
import { describe, expect, it, vi } from 'vitest';

import {
    recordSourceCorrected,
    recordSourceCorrectionRefused,
    recordSourceHoldCleared,
    recordSourceLockRefused,
} from '../sourceEvents.js';

function lineOf(emit: (sink: (line: string) => void) => void): Record<string, unknown> {
    const sink = vi.fn();

    emit(sink);

    expect(sink).toHaveBeenCalledTimes(1);

    return JSON.parse(String(sink.mock.calls[0]?.[0])) as Record<string, unknown>;
}

describe('the source lock events', () => {
    it('source.lockRefused names the route, the stage and the metric, and nothing else', () => {
        const line = lineOf((sink) => {
            recordSourceLockRefused({ route: 'update' }, 'sandbox', sink);
        });

        expect(line).toMatchObject({
            event: 'source.lockRefused',
            route: 'update',
            Stage: 'sandbox',
            'source.lockRefused': 1,
        });
        expect(line['_aws']).toMatchObject({
            CloudWatchMetrics: [
                {
                    Namespace: SOURCE_EVENT_NAMESPACE,
                    Dimensions: [['Stage']],
                    Metrics: [{ Name: 'source.lockRefused' }],
                },
            ],
        });
    });

    it('source.corrected names the ground and the old and new kind, and nothing else', () => {
        const line = lineOf((sink) => {
            recordSourceCorrected(
                { ground: 'ownerConfirmedByAccountEmail', oldKind: 'public_web', newKind: 'authored' },
                'prod',
                sink,
            );
        });

        expect(line).toMatchObject({
            event: 'source.corrected',
            ground: 'ownerConfirmedByAccountEmail',
            oldKind: 'public_web',
            newKind: 'authored',
            Stage: 'prod',
            'source.corrected': 1,
        });
    });

    it('source.correctionRefused names the refusal and the caller id', () => {
        const line = lineOf((sink) => {
            recordSourceCorrectionRefused({ refusal: 'forbidden', callerId: '01JUCALLER' }, 'prod', sink);
        });

        expect(line).toMatchObject({ event: 'source.correctionRefused', refusal: 'forbidden', callerId: '01JUCALLER' });
    });

    it('never writes the fields it was handed beyond its own: a citation, a link or a reason passed by mistake is dropped', () => {
        const line = lineOf((sink) => {
            recordSourceCorrected(
                {
                    ground: 'ownerConfirmedByAccountEmail',
                    oldKind: 'book',
                    newKind: 'authored',
                    // The type forbids these; a caller that casts them in must still not reach the line.
                    ...({
                        reason: 'SECRET REASON',
                        citation: 'SECRET TITLE',
                        sourceUrl: 'https://secret.example/',
                    } as object),
                },
                'prod',
                sink,
            );
        });
        const text = JSON.stringify(line);

        expect(text).not.toContain('SECRET');
        expect(text).not.toContain('secret.example');
    });

    it('source.holdCleared is valued at the number of holds cleared, dimensioned by Stage alone, and carries no id or reason', () => {
        const line = lineOf((sink) => {
            recordSourceHoldCleared({ released: 3 }, 'prod', sink);
        });

        expect(line).toMatchObject({ event: 'source.holdCleared', Stage: 'prod', 'source.holdCleared': 3 });
        expect(Object.keys(line).sort()).toEqual(['Stage', '_aws', 'event', 'source.holdCleared']);
        expect(line['_aws']).toMatchObject({
            CloudWatchMetrics: [
                {
                    Namespace: SOURCE_EVENT_NAMESPACE,
                    Dimensions: [['Stage']],
                    Metrics: [{ Name: 'source.holdCleared' }],
                },
            ],
        });
    });
});
