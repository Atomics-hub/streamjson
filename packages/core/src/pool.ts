import type { ContainerFrame } from './types.js'

const pool: ContainerFrame[] = []

export function acquire(type: 0 | 1): ContainerFrame {
  const f = pool.pop()
  if (f) {
    f.type = type
    f.value = type === 0 ? {} : []
    f.key = null
    f.index = 0
    return f
  }
  return { type, value: type === 0 ? {} : [], key: null, index: 0 }
}

export function release(f: ContainerFrame): void {
  pool.push(f)
}
