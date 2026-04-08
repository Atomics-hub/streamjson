import { useRef, useCallback, useState, useEffect } from 'react'
import { StreamJSON, type StreamJSONOptions } from '@a5omic/streamjson'

export interface UseStreamJSONOptions extends StreamJSONOptions {}

export function useStreamJSON<T = unknown>(options: UseStreamJSONOptions = {}) {
  const emitPartial = options.emitPartial ?? false
  const parserRef = useRef<StreamJSON | null>(null)
  const emitPartialRef = useRef(emitPartial)
  const [gen, setGen] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  if (!parserRef.current) {
    parserRef.current = new StreamJSON({ emitPartial })
  }

  useEffect(() => {
    return () => {
      parserRef.current?.reset()
    }
  }, [])

  useEffect(() => {
    if (emitPartialRef.current === emitPartial) return
    parserRef.current?.reset()
    parserRef.current = new StreamJSON({ emitPartial })
    emitPartialRef.current = emitPartial
    setIsComplete(false)
    setGen(g => g + 1)
  }, [emitPartial])

  const push = useCallback((chunk: string) => {
    parserRef.current?.push(chunk)
    setGen(g => g + 1)
  }, [])

  const end = useCallback(() => {
    parserRef.current?.end()
    setIsComplete(true)
    setGen(g => g + 1)
  }, [])

  const reset = useCallback(() => {
    parserRef.current?.reset()
    setIsComplete(false)
    setGen(g => g + 1)
  }, [])

  const value = parserRef.current?.get() as T | undefined

  return { push, end, reset, value, isComplete }
}
