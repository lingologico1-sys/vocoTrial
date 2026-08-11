/**
 * A zip writer, stored (uncompressed), in about a page of code.
 *
 * Here rather than as a dependency for the same reason this app has no router:
 * the whole requirement is "put nine files in one download", the stored format
 * is a header, the bytes, and an index of where they went, and a library for
 * that would be more bundle and more supply chain than the problem deserves.
 *
 * Not compressing is the right call as well as the easy one — the payload is
 * PNGs, which are already deflated, so a second pass would spend time to save
 * approximately nothing.
 */

export interface ZipEntry {
  name: string;
  /**
   * Backed by a plain ArrayBuffer, not the SharedArrayBuffer a bare
   * `Uint8Array` also admits. Blob parts cannot be shared memory, and saying so
   * here fails at the call site rather than at the one Blob at the bottom.
   */
  data: Uint8Array<ArrayBuffer>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Zip stores times as MS-DOS date and time words, which is a 1980 epoch and
 * two-second resolution. Nothing reads these but a file browser's "modified"
 * column, so the only requirement is that they are not nonsense.
 */
function dosStamp(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const stamp = dosStamp(new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const localBuffer = new ArrayBuffer(30);
    const local = new DataView(localBuffer);
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length

    parts.push(new Uint8Array(localBuffer), name, entry.data);

    const header = new Uint8Array(46 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true); // central directory header
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(10, 0, true); // method: stored
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true); // where its local header starts
    header.set(name, 46);
    central.push(header);

    offset += 30 + name.length + entry.data.length;
  }

  const directorySize = central.reduce((total, header) => total + header.length, 0);
  const endBuffer = new ArrayBuffer(22);
  const end = new DataView(endBuffer);
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(endBuffer)], {
    type: 'application/zip',
  });
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
