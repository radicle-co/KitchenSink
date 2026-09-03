/**
 * @module fixtures/DataTable — a presentational component with a GENERIC prop contract, a discriminated
 * union, a nested readonly object and a callback, so the extractor is exercised on shapes that are not just
 * `string | boolean`.
 */
import type { ReactNode } from 'react';

/** A column descriptor — generic in the row type. */
export interface DataTableColumn<TRow> {
    /** Stable column key. */
    readonly key: string;
    /** Header cell content. */
    readonly header: ReactNode;
    /** Renders one body cell. */
    readonly render: (row: TRow) => ReactNode;
}

/** Either an ascending or a descending sort, or none at all. */
export type DataTableSort = { readonly by: string; readonly direction: 'asc' | 'desc' } | { readonly by: null };

/** Generic props for {@link DataTable}. */
export interface DataTableProps<TRow> {
    /** The rows to render. */
    readonly rows: readonly TRow[];
    /** Column descriptors, in display order. */
    readonly columns: readonly DataTableColumn<TRow>[];
    /** Current sort. Defaults to unsorted. */
    readonly sort?: DataTableSort;
    /** Empty-state content shown when `rows` is empty. */
    readonly empty?: ReactNode;
    /** Fires when a header is activated. */
    readonly onSortChange?: (next: DataTableSort) => void;
}

/** A generic, purely presentational table. */
export const DataTable = <TRow,>({ rows, columns, empty }: DataTableProps<TRow>): ReactNode =>
    rows.length === 0 ? (
        <div>{empty}</div>
    ) : (
        <table>
            <tbody>
                {rows.map((row, index) => (
                    <tr key={index}>
                        {columns.map((column) => (
                            <td key={column.key}>{column.render(row)}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
