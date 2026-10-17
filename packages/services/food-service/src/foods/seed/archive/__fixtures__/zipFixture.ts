/**
 * Builds real zip archives in memory for the archive tests, with `yazl` (the writing half of `yauzl`'s
 * author's pair). A real zip, not a stub, because the adapter's job is to read what USDA actually ships:
 * entries nested one directory deep, a directory entry, and CSVs addressed by basename.
 *
 * `withDataDescriptors` re-writes a zip in the layout Livsmedelsverket's generated workbook uses, which `yazl` never
 * writes: every entry sets general-purpose bit 3, states its sizes in its local header anyway, and follows its data
 * with a data descriptor.
 */
import { Buffer } from 'node:buffer';
import { buffer } from 'node:stream/consumers';
import { crc32, deflateRawSync } from 'node:zlib';

import { fromBufferPromise } from 'yauzl';
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

/** General-purpose flags: bit 3 (sizes and CRC also follow the data) and bit 11 (UTF-8 names). */
const DESCRIPTOR_FLAGS = 0x0808;

/** Compression method 8, deflate. */
const DEFLATE = 8;

/**
 * Re-write a zip so every entry sets bit 3, states its CRC and sizes in its local header, and follows its deflated
 * data with a data descriptor. A streaming reader that trusts the local header's sizes then meets the descriptor's
 * signature where it expects the next entry.
 *
 * @param zip - Any zip, for example a workbook `write-excel-file` wrote.
 * @returns The same entries, in the same order, in that layout.
 * @sideEffect None beyond memory; `yauzl` reads the input.
 */
export async function withDataDescriptors(zip: Buffer): Promise<Buffer> {
    const archive = await fromBufferPromise(zip, { lazyEntries: true });
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;

    for await (const entry of archive.eachEntry()) {
        const body = await buffer(await archive.openReadStreamPromise(entry));
        const name = Buffer.from(entry.fileName, 'utf8');
        const data = deflateRawSync(body);
        const crc = crc32(body);
        const local = Buffer.alloc(30);

        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(DESCRIPTOR_FLAGS, 6);
        local.writeUInt16LE(DEFLATE, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(body.length, 22);
        local.writeUInt16LE(name.length, 26);

        const descriptor = Buffer.alloc(16);

        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(crc, 4);
        descriptor.writeUInt32LE(data.length, 8);
        descriptor.writeUInt32LE(body.length, 12);

        const header = Buffer.alloc(46);

        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(DESCRIPTOR_FLAGS, 8);
        header.writeUInt16LE(DEFLATE, 10);
        header.writeUInt32LE(crc, 16);
        header.writeUInt32LE(data.length, 20);
        header.writeUInt32LE(body.length, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt32LE(offset, 42);

        parts.push(local, name, data, descriptor);
        central.push(header, name);
        offset += local.length + name.length + data.length + descriptor.length;
    }

    archive.close();

    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    const count = central.length / 2;

    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...parts, directory, end]);
}
