/**
 * The refusal the source-call meter raises (`sourceCallMeter.ts`).
 *
 * @module
 */

/**
 * An admission asked after its request's meter was sealed: work the request left running past its own end. Refused
 * before the window is asked, so a call can never be made that the settled budget did not count. The transport reports
 * it as its own accounting failure (`SourceAccountingError`, step `admit`), and no source is called.
 */
export class SourceCallMeterSealedError extends Error {
    public constructor() {
        super('A source call was asked after its request had settled its source budget.');
        this.name = 'SourceCallMeterSealedError';
        Object.setPrototypeOf(this, SourceCallMeterSealedError.prototype);
    }
}

/** Type guard for {@link SourceCallMeterSealedError}. */
export function isSourceCallMeterSealedError(error: unknown): error is SourceCallMeterSealedError {
    return error instanceof SourceCallMeterSealedError;
}
