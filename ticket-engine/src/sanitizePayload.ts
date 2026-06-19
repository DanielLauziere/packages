export function sanitizePayload<T>(obj: T): T {
  if (obj === undefined || obj === null) return null as T

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload) as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = val === undefined ? null : sanitizePayload(val)
    }
    return result as T
  }

  return obj
}
