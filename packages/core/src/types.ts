export const enum State {
  EXPECT_VALUE = 0,
  IN_STRING = 1,
  IN_STRING_ESCAPE = 2,
  IN_STRING_UNICODE = 3,
  IN_NUMBER = 4,
  IN_KEYWORD = 5,
  EXPECT_KEY_OR_END = 6,
  EXPECT_COLON = 7,
  EXPECT_COMMA_OR_END = 8,
}

export interface ContainerFrame {
  type: 0 | 1 // 0 = object, 1 = array
  value: Record<string, unknown> | unknown[]
  key: string | null
  index: number
}

export type Path = (string | number)[]

export type ValueHandler = (path: Path, value: unknown, isComplete: boolean) => void
export type ContainerHandler = (path: Path) => void
export type ErrorHandler = (error: Error, position: number) => void

export interface EventMap {
  value: ValueHandler
  object_start: ContainerHandler
  object_end: ContainerHandler
  array_start: ContainerHandler
  array_end: ContainerHandler
  error: ErrorHandler
}

export interface StreamJSONOptions {
  emitPartial?: boolean
}
