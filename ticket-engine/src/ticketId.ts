// crc32IEEE implements the same CRC32-IEEE (reflected, 0xEDB88320) as
// Go's hash/crc32.ChecksumIEEE so ticket display ids are identical on both
// engines (cross-engine identity rule). The legacy local implementation is
// a non-standard polynomial fold and produced divergent ids across clients.
function crc32IEEE(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function ticketIdFromUUID(ticketUuid: string): number {
  return (crc32IEEE(ticketUuid) % 90000) + 10000;
}
