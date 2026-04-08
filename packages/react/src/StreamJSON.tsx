import { useRef, useEffect, useState, type ReactNode } from 'react'
import { StreamJSON as StreamJSONParser, type StreamJSONOptions } from '@a5omic/streamjson'

export interface StreamJSONProps<T = unknown> extends StreamJSONOptions {
  content: string
  complete?: boolean
  children: (value: T | undefined, isComplete: boolean) => ReactNode
}

export function StreamJSON<T = unknown>({
  content,
  complete = false,
  children,
  ...options
}: StreamJSONProps<T>) {
  const emitPartial = options.emitPartial ?? false
  const parserRef = useRef<StreamJSONParser | null>(null)
  const prevContentRef = useRef('')
  const contentRef = useRef(content)
  const completeRef = useRef(complete)
  const emitPartialRef = useRef(emitPartial)
  const [gen, setGen] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  contentRef.current = content
  completeRef.current = complete

  if (!parserRef.current) {
    parserRef.current = new StreamJSONParser({ emitPartial })
  }

  useEffect(() => {
    return () => {
      parserRef.current?.reset()
    }
  }, [])

  useEffect(() => {
    if (emitPartialRef.current === emitPartial) return

    parserRef.current?.reset()

    const parser = new StreamJSONParser({ emitPartial })
    const cur = contentRef.current
    if (cur.length > 0) parser.push(cur)
    if (completeRef.current) parser.end()

    parserRef.current = parser
    prevContentRef.current = cur
    emitPartialRef.current = emitPartial
    setIsComplete(completeRef.current)
    setGen(g => g + 1)
  }, [emitPartial])

  useEffect(() => {
    const parser = parserRef.current
    if (!parser) return

    const prev = prevContentRef.current
    if (content.length > prev.length && content.startsWith(prev)) {
      parser.push(content.slice(prev.length))
    } else if (content !== prev) {
      parser.reset()
      if (content.length > 0) parser.push(content)
      setIsComplete(false)
    }

    prevContentRef.current = content
    setGen(g => g + 1)
  }, [content])

  useEffect(() => {
    if (complete && !isComplete) {
      parserRef.current?.end()
      setIsComplete(true)
      setGen(g => g + 1)
    } else if (!complete && isComplete) {
      parserRef.current?.reset()
      const cur = contentRef.current
      if (cur.length > 0) parserRef.current?.push(cur)
      prevContentRef.current = cur
      setIsComplete(false)
      setGen(g => g + 1)
    }
  }, [complete])

  const value = parserRef.current?.get() as T | undefined

  return <>{children(value, isComplete)}</>
}
