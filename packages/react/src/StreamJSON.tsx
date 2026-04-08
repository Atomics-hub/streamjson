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
  const parserRef = useRef<StreamJSONParser | null>(null)
  const prevContentRef = useRef('')
  const [gen, setGen] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  if (!parserRef.current) {
    parserRef.current = new StreamJSONParser(options)
  }

  useEffect(() => {
    return () => {
      parserRef.current?.reset()
    }
  }, [])

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
      if (content.length > 0) parserRef.current?.push(content)
      prevContentRef.current = content
      setIsComplete(false)
      setGen(g => g + 1)
    }
  }, [complete])

  const value = parserRef.current?.get() as T | undefined

  return <>{children(value, isComplete)}</>
}
