import * as NodeZlib from "node:zlib";

/**
 * Minimal, dependency-free `.tar.gz` codec used by the desktop payload
 * hot-update channel.
 *
 * The desktop app needs to extract a downloaded payload archive at runtime, and
 * Node ships no archive reader. Rather than pull in a native/third-party
 * dependency (which would also need bundling into the Electron main bundle and
 * shipping inside the signed app), we own both ends: the release build creates
 * the archive with {@link createPayloadArchive} and the running app extracts it
 * with {@link extractPayloadArchive}. Because the same code writes and reads the
 * archive, we use a small, strict `ustar` subset and never depend on the host
 * `tar`/`unzip` binaries (whose formats differ across macOS/Linux/Windows).
 *
 * The archive only ever carries regular files; directory structure is implied
 * by file paths and recreated by the caller on extraction.
 */

const BLOCK_SIZE = 512;
const USTAR_MAGIC = "ustar\0";
const USTAR_VERSION = "00";

export interface PayloadArchiveEntry {
  /** POSIX-style relative path (forward slashes), never absolute or `..`-escaping. */
  readonly path: string;
  readonly data: Uint8Array;
  /** Unix mode bits; defaults to 0o644 when omitted. */
  readonly mode?: number;
}

export class PayloadArchiveError extends Error {
  override readonly name = "PayloadArchiveError";
}

function normalizeArchivePath(rawPath: string): string {
  const normalized = rawPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized.length === 0) {
    throw new PayloadArchiveError("Refusing archive entry with an empty path.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new PayloadArchiveError(`Refusing path-traversing archive entry: ${rawPath}`);
  }
  return normalized;
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  // tar octal fields are `length - 1` octal digits followed by a NUL terminator.
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, length - 1, "ascii");
  buffer.writeUInt8(0, offset + length - 1);
}

function splitName(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path, "utf8") <= 100) {
    return { name: path, prefix: "" };
  }
  // ustar stores the leading directories in a 155-byte prefix field, joined to
  // `name` with an implicit "/". Split at the last "/" that keeps both halves
  // within their fields.
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) {
    throw new PayloadArchiveError(`Archive path too long for ustar header: ${path}`);
  }
  const name = path.slice(lastSlash + 1);
  const prefix = path.slice(0, lastSlash);
  if (Buffer.byteLength(name, "utf8") > 100 || Buffer.byteLength(prefix, "utf8") > 155) {
    throw new PayloadArchiveError(`Archive path too long for ustar header: ${path}`);
  }
  return { name, prefix };
}

function buildHeader(entry: PayloadArchiveEntry, normalizedPath: string): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE);
  const { name, prefix } = splitName(normalizedPath);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, (entry.mode ?? 0o644) & 0o7777, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, entry.data.byteLength, 124, 12);
  writeOctal(header, 0, 136, 12); // mtime — fixed for reproducible archives
  header.write("0", 156, 1, "ascii"); // typeflag: regular file
  header.write(USTAR_MAGIC, 257, 6, "ascii");
  header.write(USTAR_VERSION, 263, 2, "ascii");
  if (prefix.length > 0) {
    header.write(prefix, 345, 155, "utf8");
  }

  // Checksum: computed with the checksum field filled with spaces.
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    checksum += header[index] ?? 0;
  }
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header.writeUInt8(0, 154);
  header.writeUInt8(0x20, 155);
  return header;
}

function padToBlock(size: number): number {
  const remainder = size % BLOCK_SIZE;
  return remainder === 0 ? 0 : BLOCK_SIZE - remainder;
}

/** Build a gzip-compressed tar archive from in-memory file entries. */
export function createPayloadArchive(entries: ReadonlyArray<PayloadArchiveEntry>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const normalizedPath = normalizeArchivePath(entry.path);
    chunks.push(buildHeader(entry, normalizedPath));
    chunks.push(Buffer.from(entry.data));
    const padding = padToBlock(entry.data.byteLength);
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  // Two trailing zero blocks mark the end of the archive.
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
  const tar = Buffer.concat(chunks);
  return new Uint8Array(NodeZlib.gzipSync(tar));
}

function parseOctal(buffer: Buffer, offset: number, length: number): number {
  const field = buffer.toString("ascii", offset, offset + length);
  const nulIndex = field.indexOf("\0");
  const raw = (nulIndex === -1 ? field : field.slice(0, nulIndex)).trim();
  if (raw.length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 8);
  if (Number.isNaN(parsed)) {
    throw new PayloadArchiveError(`Invalid octal tar field: "${raw}"`);
  }
  return parsed;
}

function readNulTerminated(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.toString("utf8", 0, end === -1 ? length : end);
}

function isZeroBlock(buffer: Buffer, offset: number): boolean {
  for (let index = offset; index < offset + BLOCK_SIZE; index += 1) {
    if (buffer[index] !== 0) {
      return false;
    }
  }
  return true;
}

/** Decompress and parse a {@link createPayloadArchive} archive back into entries. */
export function extractPayloadArchive(archive: Uint8Array): PayloadArchiveEntry[] {
  const tar = NodeZlib.gunzipSync(Buffer.from(archive));
  if (tar.byteLength % BLOCK_SIZE !== 0) {
    throw new PayloadArchiveError("Corrupt payload archive: not a multiple of the tar block size.");
  }

  const entries: PayloadArchiveEntry[] = [];
  let offset = 0;
  while (offset + BLOCK_SIZE <= tar.byteLength) {
    if (isZeroBlock(tar, offset)) {
      break;
    }
    const name = readNulTerminated(tar, offset, 100);
    const prefix = readNulTerminated(tar, offset + 345, 155);
    const mode = parseOctal(tar, offset + 100, 8);
    const size = parseOctal(tar, offset + 124, 12);
    const typeflag = tar.toString("ascii", offset + 156, offset + 157);
    const fullPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.byteLength) {
      throw new PayloadArchiveError(
        "Corrupt payload archive: entry data extends past the archive.",
      );
    }

    // typeflag "0" / "\0" are regular files; everything else (dirs, pax/global
    // extended headers, links) is skipped — the writer only ever emits files.
    if (typeflag === "0" || typeflag === "\0") {
      const safePath = normalizeArchivePath(fullPath);
      entries.push({
        path: safePath,
        data: new Uint8Array(tar.subarray(dataStart, dataEnd)),
        mode: mode === 0 ? 0o644 : mode,
      });
    }

    offset = dataEnd + padToBlock(size);
  }

  return entries;
}
