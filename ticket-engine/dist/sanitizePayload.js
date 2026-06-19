export function sanitizePayload(obj) {
    if (obj === undefined || obj === null)
        return null;
    if (Array.isArray(obj)) {
        return obj.map(sanitizePayload);
    }
    if (typeof obj === 'object') {
        const result = {};
        for (const [key, val] of Object.entries(obj)) {
            result[key] = val === undefined ? null : sanitizePayload(val);
        }
        return result;
    }
    return obj;
}
//# sourceMappingURL=sanitizePayload.js.map