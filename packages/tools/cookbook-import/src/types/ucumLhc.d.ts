/**
 * Minimal typings for `@lhncbc/ucum-lhc`, which ships JavaScript with no declarations.
 *
 * ⛔ Declared NARROWLY on purpose — only `convertUnitTo`, which is the one call `standardUnits.ts` makes.
 * A blanket `declare module '@lhncbc/ucum-lhc';` would type the whole package as `any` and defeat the
 * repository's no-`any` rule at exactly the boundary where an external library's shape is least certain.
 *
 * The shape is taken from the library's own runtime behaviour, probed against v7.1.9: `convertUnitTo`
 * returns `{ status: 'succeeded' | ..., toVal: number | null, msg: string[] }`, and `status` is checked
 * before `toVal` is read because a failed conversion still returns an object.
 */
declare module '@lhncbc/ucum-lhc' {
    /** What a conversion attempt reports. */
    export interface UcumConversionResult {
        /** `'succeeded'` when `toVal` is meaningful; any other value means it is not. */
        readonly status: string;
        /** The converted magnitude, or `null` when the conversion failed. */
        readonly toVal: number | null;
        /** Human-readable diagnostics, empty on success. */
        readonly msg?: readonly string[];
    }

    /** The library's conversion façade. */
    export class UcumLhcUtils {
        /** The memoized singleton; constructing it parses the whole UCUM table. */
        static getInstance(): UcumLhcUtils;
        /** Convert `count` of the unit named by `fromCode` into `toCode`. */
        convertUnitTo(fromCode: string, count: number, toCode: string): UcumConversionResult;
    }
}
