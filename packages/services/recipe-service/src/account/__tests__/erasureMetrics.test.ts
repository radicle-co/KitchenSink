/**
 * Unit tests for {@link ServicePrincipalErasureMetrics} (CR-002 / U4a — least-privilege DETECTION).
 *
 * A service-principal erasure is event-bound (one target ownerId per verified token), so a leaked key
 * cannot erase arbitrary accounts at will — but a BURST of distinct owners is still the signature of a
 * compromised signer. This emitter is the detective control: one CloudWatch EMF line per
 * service-attributed erasure, which a volume alarm (the CDK seam) watches. These tests pin the EMF
 * envelope shape the alarm extracts by, so the emitted metric can never silently drift from the alarm.
 */
import { describe, it, expect, vi } from 'vitest';

import {
    ServicePrincipalErasureMetrics,
    SERVICE_PRINCIPAL_ERASURE_METRIC,
    SERVICE_PRINCIPAL_ERASURE_NAMESPACE,
} from '../erasureMetrics.js';

interface EmfLine {
    _aws: {
        Timestamp: number;
        CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[];
    };
    Stage: string;
    [key: string]: unknown;
}

describe('ServicePrincipalErasureMetrics', () => {
    it('emits exactly one EMF line per service-principal erasure', () => {
        const sink = vi.fn();
        const metrics = new ServicePrincipalErasureMetrics('prod', sink);

        metrics.recordServicePrincipalErasure({ ownerId: 'owner-1' });

        expect(sink).toHaveBeenCalledOnce();
    });

    it('publishes a Count=1 metric under the pinned namespace + name the alarm watches', () => {
        const sink = vi.fn();
        const metrics = new ServicePrincipalErasureMetrics('prod', sink);

        metrics.recordServicePrincipalErasure({ ownerId: 'owner-1' });

        const line = JSON.parse(sink.mock.calls[0]?.[0] as string) as EmfLine;
        const directive = line._aws.CloudWatchMetrics[0];
        expect(directive?.Namespace).toBe(SERVICE_PRINCIPAL_ERASURE_NAMESPACE);
        expect(directive?.Metrics).toEqual([{ Name: SERVICE_PRINCIPAL_ERASURE_METRIC, Unit: 'Count' }]);
        expect(line[SERVICE_PRINCIPAL_ERASURE_METRIC]).toBe(1);
    });

    it('carries the Stage dimension so alarms scope per deploy stage', () => {
        const sink = vi.fn();
        const metrics = new ServicePrincipalErasureMetrics('sandbox', sink);

        metrics.recordServicePrincipalErasure({ ownerId: 'owner-1' });

        const line = JSON.parse(sink.mock.calls[0]?.[0] as string) as EmfLine;
        expect(line._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['Stage']]);
        expect(line.Stage).toBe('sandbox');
    });

    it('records the target owner alongside the metric so an incident can enumerate distinct owners', () => {
        const sink = vi.fn();
        const metrics = new ServicePrincipalErasureMetrics('prod', sink);

        metrics.recordServicePrincipalErasure({ ownerId: 'owner-42' });

        const line = JSON.parse(sink.mock.calls[0]?.[0] as string) as EmfLine;
        // The ownerId rides the structured line (not as a metric dimension — that would explode
        // cardinality) so an operator triaging a volume-alarm burst can count DISTINCT owners.
        expect(line['ownerId']).toBe('owner-42');
    });
});
