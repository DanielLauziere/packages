function crc32(str) {
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        crc ^= ch;
        for (let j = 0; j < 8; j++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
export function ticketIdFromUUID(ticketUuid) {
    return (crc32(ticketUuid) % 90000) + 10000;
}
//# sourceMappingURL=ticketId.js.map