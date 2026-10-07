/** Collision-free JSON tuples: user objects are always encoded as entry arrays. */
export type PortableValue =
  | null
  | string
  | number
  | boolean
  | ['undefined']
  | ['bigint', string]
  | ['bytes' | 'buffer' | 'date', string]
  | ['array', PortableValue[]]
  | ['object', [string, PortableValue][]]
  | ['map', [PortableValue, PortableValue][]]

export const PORTABLE_MAX_DEPTH = 64
export const PORTABLE_MAX_NODES = 1_000_000
export const PORTABLE_MAX_TEXT_BYTES = 64_000_000

export class PortableCodecError extends Error {
  constructor(message = 'Invalid portable recovery value') {
    super(message)
    this.name = 'PortableCodecError'
  }
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  return btoa(chunks.join(''))
}

function fromBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new PortableCodecError('Invalid binary encoding')
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  if (base64(bytes) !== value) throw new PortableCodecError('Noncanonical binary encoding')
  return bytes
}

function budget() {
  let nodes = 0
  return (depth: number) => {
    if (depth > PORTABLE_MAX_DEPTH || ++nodes > PORTABLE_MAX_NODES)
      throw new PortableCodecError('Recovery value exceeds complexity limits')
  }
}

export function encodePortableValue(value: unknown): PortableValue {
  const check = budget()
  const parents = new Set<object>()
  function visit(part: unknown, depth: number): PortableValue {
    check(depth)
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return part
    if (typeof part === 'number' && Number.isFinite(part) && !Object.is(part, -0)) return part
    if (part === undefined) return ['undefined']
    if (typeof part === 'bigint') return ['bigint', part.toString()]
    if (part instanceof Uint8Array) return ['bytes', base64(part)]
    if (part instanceof ArrayBuffer) return ['buffer', base64(new Uint8Array(part))]
    if (part instanceof Date && Number.isFinite(part.getTime())) return ['date', part.toISOString()]
    if (typeof part !== 'object' || part === null || parents.has(part))
      throw new PortableCodecError('Unsupported or cyclic recovery value')
    parents.add(part)
    try {
      if (Array.isArray(part)) {
        if (Object.keys(part).length !== part.length)
          throw new PortableCodecError('Sparse or extended arrays are unsupported')
        return ['array', part.map((item) => visit(item, depth + 1))]
      }
      if (part instanceof Map)
        return [
          'map',
          Array.from(part, ([key, item]) => [visit(key, depth + 1), visit(item, depth + 1)]),
        ]
      if (
        Object.getPrototypeOf(part) !== Object.prototype ||
        Object.getOwnPropertySymbols(part).length
      )
        throw new PortableCodecError('Unsupported recovery object')
      const entries = Object.entries(Object.getOwnPropertyDescriptors(part)).map(
        ([key, descriptor]): [string, PortableValue] => {
          if (!descriptor.enumerable || !('value' in descriptor))
            throw new PortableCodecError('Recovery objects must contain enumerable data properties')
          return [key, visit(descriptor.value, depth + 1)]
        },
      )
      return ['object', entries]
    } finally {
      parents.delete(part)
    }
  }
  return visit(value, 0)
}

export function decodePortableValue(value: unknown): unknown {
  const check = budget()
  function visit(part: unknown, depth: number): unknown {
    check(depth)
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return part
    if (typeof part === 'number' && Number.isFinite(part) && !Object.is(part, -0)) return part
    if (!Array.isArray(part)) throw new PortableCodecError()
    const [tag, payload] = part
    if (tag === 'undefined' && part.length === 1) return undefined
    if (part.length !== 2) throw new PortableCodecError()
    if (tag === 'bigint' && typeof payload === 'string' && /^(?:0|-?[1-9]\d*)$/.test(payload))
      return BigInt(payload)
    if ((tag === 'bytes' || tag === 'buffer') && typeof payload === 'string') {
      const bytes = fromBase64(payload)
      return tag === 'bytes' ? bytes : bytes.buffer
    }
    if (tag === 'date' && typeof payload === 'string') {
      const date = new Date(payload)
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== payload)
        throw new PortableCodecError('Invalid date encoding')
      return date
    }
    if (!Array.isArray(payload)) throw new PortableCodecError()
    if (tag === 'array') return payload.map((item) => visit(item, depth + 1))
    if (tag !== 'object' && tag !== 'map') throw new PortableCodecError()
    const entries = payload.map((entry): [unknown, unknown] => {
      if (!Array.isArray(entry) || entry.length !== 2) throw new PortableCodecError()
      const key = tag === 'object' ? entry[0] : visit(entry[0], depth + 1)
      if (tag === 'object' && typeof key !== 'string') throw new PortableCodecError()
      return [key, visit(entry[1], depth + 1)]
    })
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      throw new PortableCodecError('Duplicate recovery entry')
    // fromEntries defines own properties, including __proto__, without prototype mutation.
    return tag === 'map' ? new Map(entries) : Object.fromEntries(entries)
  }
  return visit(value, 0)
}

export function stringifyPortableValue(value: unknown): string {
  const text = JSON.stringify(encodePortableValue(value))
  if (new TextEncoder().encode(text).byteLength > PORTABLE_MAX_TEXT_BYTES)
    throw new PortableCodecError('Recovery plaintext exceeds size limit')
  return text
}

export function parsePortableValue(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > PORTABLE_MAX_TEXT_BYTES)
    throw new PortableCodecError('Recovery plaintext exceeds size limit')
  try {
    return decodePortableValue(JSON.parse(text))
  } catch (error) {
    if (error instanceof PortableCodecError) throw error
    throw new PortableCodecError()
  }
}
