import { State, type ContainerFrame, type StreamJSONOptions, type EventMap, type Path } from './types.js'
import { acquire, release } from './pool.js'

const ESCAPE_MAP: Record<string, string> = {
  '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
}

const HEX = /^[0-9a-fA-F]$/

export class StreamJSON {
  private state: State = State.EXPECT_VALUE
  private stack: ContainerFrame[] = []
  private root: unknown = undefined
  private hasRoot = false
  private rootComplete = false

  private strBuf = ''
  private numBuf = ''
  private isKey = false

  private kwTarget = ''
  private kwPos = 0

  private uniAccum = ''
  private uniCount = 0
  private highSurrogate = 0

  private done = false
  private pos = 0
  private emitPartial: boolean

  private listeners: Map<string, Set<Function>> = new Map()

  constructor(options?: StreamJSONOptions) {
    this.emitPartial = options?.emitPartial ?? false
  }

  push(chunk: string): void {
    if (this.done || this.rootComplete) return
    const len = chunk.length
    for (let i = 0; i < len; i++) {
      if (this.rootComplete) return
      const c = chunk.charCodeAt(i)
      switch (this.state) {
        case State.IN_STRING:
          this.parseString(c, chunk[i])
          break
        case State.IN_STRING_ESCAPE:
          this.parseEscape(c, chunk[i])
          break
        case State.IN_STRING_UNICODE:
          this.parseUnicode(chunk[i])
          break
        case State.IN_NUMBER:
          this.parseNumber(c, chunk[i])
          if (this.rootComplete) return
          break
        case State.IN_KEYWORD:
          this.parseKeyword(c, chunk[i])
          break
        case State.EXPECT_VALUE:
          this.parseExpectValue(c, chunk[i])
          break
        case State.EXPECT_KEY_OR_END:
          this.parseExpectKeyOrEnd(c, chunk[i])
          break
        case State.EXPECT_COLON:
          if (c === 0x3A) this.state = State.EXPECT_VALUE // :
          else if (c !== 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) {
            this.emitError('Expected colon')
          }
          break
        case State.EXPECT_COMMA_OR_END:
          this.parseCommaOrEnd(c, chunk[i])
          break
      }
      this.pos++
    }
  }

  end(): void {
    if (this.done) return
    this.done = true
    this.flush()
  }

  get(): unknown {
    return this.root
  }

  reset(): void {
    for (let i = 0; i < this.stack.length; i++) release(this.stack[i])
    this.state = State.EXPECT_VALUE
    this.stack.length = 0
    this.root = undefined
    this.hasRoot = false
    this.rootComplete = false
    this.strBuf = ''
    this.numBuf = ''
    this.isKey = false
    this.kwTarget = ''
    this.kwPos = 0
    this.uniAccum = ''
    this.uniCount = 0
    this.highSurrogate = 0
    this.done = false
    this.pos = 0
  }

  on<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
  }

  off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    this.listeners.get(event)?.delete(handler)
  }

  static parse(json: string): unknown {
    const p = new StreamJSON()
    p.push(json)
    p.end()
    return p.get()
  }

  // --- State handlers ---

  private parseString(c: number, _ch: string): void {
    if (c === 0x22) { // "
      this.flushHighSurrogate()
      this.endString()
    } else if (c === 0x5C) { // backslash
      this.flushHighSurrogate()
      this.state = State.IN_STRING_ESCAPE
    } else {
      // flush pending lone high surrogate before appending a literal char
      this.flushHighSurrogate()
      this.strBuf += _ch
      if (!this.isKey && this.emitPartial) this.updatePartial()
    }
  }

  private parseEscape(c: number, ch: string): void {
    if (c === 0x75) { // u
      this.uniAccum = ''
      this.uniCount = 0
      this.state = State.IN_STRING_UNICODE
    } else {
      const mapped = ESCAPE_MAP[ch]
      if (mapped !== undefined) {
        this.strBuf += mapped
      } else {
        this.emitError(`Invalid escape sequence: \\${ch}`)
        this.strBuf += ch
      }
      this.state = State.IN_STRING
      if (!this.isKey && this.emitPartial) this.updatePartial()
    }
  }

  private parseUnicode(ch: string): void {
    if (!HEX.test(ch)) {
      this.emitError(`Invalid hex digit in unicode escape: ${ch}`)
      this.state = State.IN_STRING
      return
    }
    this.uniAccum += ch
    this.uniCount++
    if (this.uniCount === 4) {
      const cp = parseInt(this.uniAccum, 16)
      if (this.highSurrogate) {
        if (cp >= 0xDC00 && cp <= 0xDFFF) {
          const full = (this.highSurrogate - 0xD800) * 0x400 + (cp - 0xDC00) + 0x10000
          this.strBuf += String.fromCodePoint(full)
        } else {
          this.strBuf += String.fromCharCode(this.highSurrogate)
          this.strBuf += String.fromCharCode(cp)
        }
        this.highSurrogate = 0
      } else if (cp >= 0xD800 && cp <= 0xDBFF) {
        this.highSurrogate = cp
      } else {
        this.strBuf += String.fromCharCode(cp)
      }
      this.state = State.IN_STRING
      if (!this.isKey && this.emitPartial) this.updatePartial()
    }
  }

  private parseNumber(c: number, ch: string): void {
    if (c >= 0x30 && c <= 0x39) {
      if ((this.numBuf === '0' || this.numBuf === '-0') && c >= 0x30 && c <= 0x39) {
        // leading zero followed by another digit — emit error, end the 0, reprocess
        this.emitError(`Leading zero in number: ${this.numBuf}${ch}`)
        this.endNumber()
        this.reprocessAfterNumber(c, ch)
        return
      }
      this.numBuf += ch
    } else if (c === 0x2E || c === 0x65 || c === 0x45) {
      this.numBuf += ch
    } else if (c === 0x2B || c === 0x2D) {
      // + and - only valid after e/E or at start (- only at start)
      const last = this.numBuf[this.numBuf.length - 1]
      if (last === 'e' || last === 'E') {
        this.numBuf += ch
      } else {
        this.endNumber()
        this.reprocessAfterNumber(c, ch)
      }
    } else {
      this.endNumber()
      this.reprocessAfterNumber(c, ch)
    }
  }

  private reprocessAfterNumber(c: number, ch: string): void {
    if (this.rootComplete) return
    switch (this.state) {
      case State.EXPECT_COMMA_OR_END:
        this.parseCommaOrEnd(c, ch)
        break
    }
  }

  private parseKeyword(c: number, ch: string): void {
    if (ch === this.kwTarget[this.kwPos]) {
      this.kwPos++
      if (this.kwPos === this.kwTarget.length) {
        const val = this.kwTarget === 'true' ? true : this.kwTarget === 'false' ? false : null
        this.assignValue(val)
        this.emit('value', this.currentPath(), val, true)
        this.afterValue()
      }
    } else {
      this.emitError(`Unexpected character in keyword: ${ch}`)
      this.recoverKeyword()
      if (this.state === State.EXPECT_COMMA_OR_END) {
        this.parseCommaOrEnd(c, ch)
      }
    }
  }

  private parseExpectValue(c: number, ch: string): void {
    if (c === 0x22) { // "
      this.strBuf = ''
      this.isKey = false
      this.state = State.IN_STRING
    } else if (c === 0x7B) { // {
      this.beginContainer(0)
      this.state = State.EXPECT_KEY_OR_END
    } else if (c === 0x5B) { // [
      this.beginContainer(1)
      this.state = State.EXPECT_VALUE
    } else if ((c >= 0x30 && c <= 0x39) || c === 0x2D) { // digit or -
      this.numBuf = ch
      this.state = State.IN_NUMBER
    } else if (c === 0x74) { // t
      this.kwTarget = 'true'
      this.kwPos = 1
      this.state = State.IN_KEYWORD
    } else if (c === 0x66) { // f
      this.kwTarget = 'false'
      this.kwPos = 1
      this.state = State.IN_KEYWORD
    } else if (c === 0x6E) { // n
      this.kwTarget = 'null'
      this.kwPos = 1
      this.state = State.IN_KEYWORD
    } else if (c === 0x5D) { // ] — empty array
      if (this.stack.length > 0 && this.stack[this.stack.length - 1].type === 1) {
        this.endContainer()
        this.afterValue()
      } else {
        this.emitError('Unexpected ]')
      }
    } else if (c === 0x7D) { // } — empty value recovery (e.g. {"a": })
      if (this.stack.length > 0 && this.stack[this.stack.length - 1].type === 0) {
        this.endContainer()
        this.afterValue()
      } else {
        this.emitError('Unexpected }')
      }
    } else if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) {
      // whitespace — skip
    } else {
      this.emitError(`Unexpected character: ${ch}`)
    }
  }

  private parseExpectKeyOrEnd(c: number, _ch: string): void {
    if (c === 0x22) { // "
      this.strBuf = ''
      this.isKey = true
      this.state = State.IN_STRING
    } else if (c === 0x7D) { // }
      this.endContainer()
      this.afterValue()
    } else if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) {
      // whitespace
    } else {
      this.emitError(`Expected key or }`)
    }
  }

  private parseCommaOrEnd(c: number, ch: string): void {
    if (c === 0x2C) { // ,
      const top = this.stack[this.stack.length - 1]
      if (top) {
        this.state = top.type === 0 ? State.EXPECT_KEY_OR_END : State.EXPECT_VALUE
      }
    } else if (c === 0x7D) { // }
      if (this.stack.length > 0 && this.stack[this.stack.length - 1].type === 0) {
        this.endContainer()
        this.afterValue()
      }
    } else if (c === 0x5D) { // ]
      if (this.stack.length > 0 && this.stack[this.stack.length - 1].type === 1) {
        this.endContainer()
        this.afterValue()
      }
    } else if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) {
      // whitespace
    } else if (c === 0x22) {
      // missing comma recovery — treat as implicit comma
      const top = this.stack[this.stack.length - 1]
      if (top && top.type === 0) {
        this.strBuf = ''
        this.isKey = true
        this.state = State.IN_STRING
      } else if (top) {
        this.strBuf = ''
        this.isKey = false
        this.state = State.IN_STRING
      }
    } else if (c === 0x7B || c === 0x5B || (c >= 0x30 && c <= 0x39) || c === 0x2D ||
               c === 0x74 || c === 0x66 || c === 0x6E) {
      // missing comma recovery for non-string values — arrays AND objects
      const top = this.stack[this.stack.length - 1]
      if (top) {
        if (top.type === 0) {
          // in object without a key — this is malformed, skip
          this.emitError(`Missing key for value in object`)
        } else {
          this.parseExpectValue(c, ch)
        }
      }
    }
  }

  // --- Core operations ---

  private beginContainer(type: 0 | 1): void {
    const frame = acquire(type)
    if (!this.hasRoot) {
      this.root = frame.value
      this.hasRoot = true
    } else {
      this.assignValue(frame.value)
    }
    const ename = type === 0 ? 'object_start' : 'array_start'
    this.emit(ename, this.currentPath())
    this.stack.push(frame)
  }

  private endContainer(): void {
    const frame = this.stack.pop()
    if (!frame) return
    const ename = frame.type === 0 ? 'object_end' : 'array_end'
    this.emit(ename, this.currentPath())
    release(frame)
  }

  private endString(): void {
    if (this.isKey) {
      const top = this.stack[this.stack.length - 1]
      if (top) top.key = this.strBuf
      this.state = State.EXPECT_COLON
    } else {
      const val = this.strBuf
      this.assignValue(val)
      this.emit('value', this.currentPath(), val, true)
      this.afterValue()
    }
    this.strBuf = ''
  }

  private endNumber(): void {
    const buf = this.numBuf
    this.numBuf = ''
    const val = Number(buf)
    if (Number.isNaN(val) || !Number.isFinite(val)) {
      this.emitError(`Invalid number: ${buf}`)
      // assign null to preserve position — prevents key drops (objects) and index shifts (arrays)
      if (this.stack.length > 0) {
        const top = this.stack[this.stack.length - 1]
        if ((top.type === 0 && top.key !== null) || top.type === 1) {
          this.assignValue(null)
        }
      }
      this.afterValue()
      return
    }
    if (buf.length > 1 && buf[0] === '0' && buf[1] >= '0' && buf[1] <= '9') {
      this.emitError(`Leading zero in number: ${buf}`)
    }
    if (buf.endsWith('.')) {
      this.emitError(`Trailing dot in number: ${buf}`)
    }
    this.assignValue(val)
    this.emit('value', this.currentPath(), val, true)
    this.afterValue()
  }

  private recoverKeyword(): void {
    const prefix = this.kwTarget.slice(0, this.kwPos)
    let val: unknown
    if (prefix.startsWith('t')) val = true
    else if (prefix.startsWith('f')) val = false
    else val = null
    this.assignValue(val)
    this.emit('value', this.currentPath(), val, true)
    this.afterValue()
  }

  private assignValue(val: unknown): void {
    if (this.stack.length === 0) {
      this.root = val
      this.hasRoot = true
      return
    }
    const top = this.stack[this.stack.length - 1]
    if (top.type === 0) {
      if (top.key !== null) {
        (top.value as Record<string, unknown>)[top.key] = val
      }
    } else {
      (top.value as unknown[])[top.index] = val
      top.index++
    }
  }

  private updatePartial(): void {
    if (this.stack.length === 0) {
      this.root = this.strBuf
      this.hasRoot = true
      return
    }
    const top = this.stack[this.stack.length - 1]
    if (top.type === 0) {
      if (top.key !== null) {
        (top.value as Record<string, unknown>)[top.key] = this.strBuf
      }
    } else {
      (top.value as unknown[])[top.index] = this.strBuf
    }
    this.emit('value', this.partialPath(), this.strBuf, false)
  }

  private afterValue(): void {
    if (this.stack.length === 0) {
      this.rootComplete = true
    }
    this.state = State.EXPECT_COMMA_OR_END
  }

  private flushHighSurrogate(): void {
    if (this.highSurrogate) {
      this.strBuf += String.fromCharCode(this.highSurrogate)
      this.highSurrogate = 0
    }
  }

  private flush(): void {
    if (this.state === State.IN_STRING || this.state === State.IN_STRING_ESCAPE || this.state === State.IN_STRING_UNICODE) {
      this.flushHighSurrogate()
      if (this.isKey) {
        const top = this.stack[this.stack.length - 1]
        if (top) top.key = this.strBuf
        // key with no value — fall through to assign null below
        this.state = State.EXPECT_COLON
      } else {
        this.assignValue(this.strBuf)
        this.emit('value', this.currentPath(), this.strBuf, true)
        this.afterValue()
      }
      this.strBuf = ''
    } else if (this.state === State.IN_NUMBER) {
      if (this.numBuf.length > 0) this.endNumber()
    } else if (this.state === State.IN_KEYWORD) {
      this.recoverKeyword()
    }
    // handle truncated key with no value
    if (this.state === State.EXPECT_COLON || this.state === State.EXPECT_VALUE) {
      const top = this.stack[this.stack.length - 1]
      if (top && top.type === 0 && top.key !== null) {
        this.assignValue(null)
        this.emit('value', this.currentPath(), null, true)
      }
    }
    while (this.stack.length > 0) {
      this.endContainer()
    }
  }

  private currentPath(): Path {
    const path: Path = []
    for (let i = 0; i < this.stack.length; i++) {
      const f = this.stack[i]
      if (f.type === 0) {
        if (f.key !== null) path.push(f.key)
      } else {
        // after assignValue, index is already incremented, so use index-1
        path.push(f.index > 0 ? f.index - 1 : f.index)
      }
    }
    return path
  }

  private partialPath(): Path {
    const path: Path = []
    for (let i = 0; i < this.stack.length; i++) {
      const f = this.stack[i]
      if (f.type === 0) {
        if (f.key !== null) path.push(f.key)
      } else {
        // during partial updates, index has NOT been incremented yet
        path.push(f.index)
      }
    }
    return path
  }

  private emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of set) {
      (fn as Function)(...args)
    }
  }

  private emitError(msg: string): void {
    const set = this.listeners.get('error')
    if (set) {
      for (const fn of set) {
        (fn as Function)(new Error(msg), this.pos)
      }
    }
  }
}
