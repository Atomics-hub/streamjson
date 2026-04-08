import type { ContainerFrame } from './types.js'

const MAX_POOL = 8

const pool: ContainerFrame[] = []

export function acquire(type: 0 | 1): ContainerFrame {
  const f = pool.pop()
  if (f) {
    f.type = type
    f.value = type === 0 ? Object.create(null) : []
    f.key = null
    f.index = 0
    return f
  }
  return { type, value: type === 0 ? Object.create(null) : [], key: null, index: 0 }
}

export function release(f: ContainerFrame): void {
  if (pool.length < MAX_POOL) pool.push(f)
}
