/**
 * Builds real zip archives in memory for the archive tests, with `yazl` (the writing half of `yauzl`'s
 * author's pair). A real zip, not a stub, because the adapter's job is to read what USDA actually ships:
 * entries nested one directory deep, a directory entry, and CSVs addressed by basename.
 */
import { Buffer } from 'node:buffer';

import { ZipFile } from 'yazl';

/** A fixed timestamp, so two builds of one fixture are byte-identical. */
const FIXED_MTIME = new Date('2026-04-30T00:00:00Z');

/**
 * Build a zip holding the given entries.
 *
 * @param entries - Entry path → body: text is written as UTF-8, bytes as given (CNF writes Windows-1252). A path
 *   ending in `/` adds a directory entry.
 * @returns The archive's bytes.
 * @sideEffect None beyond memory; `yazl` streams into a buffer.
 */
export async function makeZip(entries: Readonly<Record<string, string | Buffer>>): Promise<Buffer> {
    const zip = new ZipFile();

    for (const [path, body] of Object.entries(entries)) {
        if (path.endsWith('/')) {
            zip.addEmptyDirectory(path, { mtime: FIXED_MTIME });
        } else {
            zip.addBuffer(typeof body === 'string' ? Buffer.from(body, 'utf8') : body, path, { mtime: FIXED_MTIME });
        }
    }

    zip.end();

    const chunks: Buffer[] = [];

    for await (const chunk of zip.outputStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

/**
 * Quote every field the way FDC does, and join rows with LF.
 *
 * @param rows - The header row, then the data rows.
 * @returns The CSV text.
 */
export function fdcCsv(rows: readonly (readonly string[])[]): string {
    return `${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;
}
