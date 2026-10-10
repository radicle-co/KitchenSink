/**
 * The transport's admission port, counting each admitted call on the running request's {@link SourceCallMeter}.
 * Composed only into the API process's registry (`foods.module.ts`), whose source calls are the budgeted ones; the
 * worker composes the limiter bare. Outside a metered request, admission passes through unchanged.
 *
 * @pattern Decorator — over the transport's `AdmissionPolicy` port
 * @module
 */
import type { CallableApiSourceId } from '../../sources/sourceRegister.js';
import type { Admission, AdmissionPolicy, SourceCallChannel } from '../../sources/transport/transportPorts.js';
import { SourceCallMeter } from './sourceCallMeter.js';

export class MeteredAdmission implements AdmissionPolicy {
    /** @param inner - The policy that decides and charges the shared window: the limiter, in production. */
    public constructor(private readonly inner: AdmissionPolicy) {}

    /**
     * Ask the inner policy, counting the call on the running request's meter when there is one.
     *
     * @param source - The source to be called.
     * @param lane - Who is spending the call.
     * @returns The inner policy's answer, unchanged.
     * @throws {SourceCallMeterSealedError} when the request's meter is sealed; the inner policy is not asked.
     * @throws Whatever the inner policy throws, unchanged.
     * @sideEffect Charges the source's window when admitting (the inner policy); counts on the meter.
     */
    public async admit(source: CallableApiSourceId, lane: SourceCallChannel): Promise<Admission> {
        const meter = SourceCallMeter.current();

        if (meter === undefined) {
            return this.inner.admit(source, lane);
        }

        return meter.count(async () => this.inner.admit(source, lane));
    }
}
