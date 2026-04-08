# StreamJSON

[![npm version](https://img.shields.io/npm/v/@a5omic/streamjson.svg)](https://www.npmjs.com/package/@a5omic/streamjson)
[![license](https://img.shields.io/npm/l/@a5omic/streamjson.svg)](https://github.com/Atomics-hub/streamjson/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@a5omic/streamjson)](https://bundlephobia.com/package/@a5omic/streamjson)

O(1) streaming JSON parser for the AI era. Zero dependencies. ~4KB gzipped.

Every other "streaming JSON" library re-parses the entire accumulated string on every chunk — O(n²) total. StreamJSON processes each byte exactly once and maintains a live object tree. `parser.get()` returns the current state in O(1).

## Benchmarks

```
STREAMING (simulated LLM token delivery, 612 bytes)

Library             Median (ms)    Speedup
StreamJSON                0.024       1.0x ⚡
partial-json              1.317      55.8x
jsonrepair                2.184      92.4x
best-effort               0.785      33.2x

SCALE TEST (per-chunk cost as payload grows)

Size         StreamJSON (µs/chunk)    partial-json (µs/chunk)    Ratio
1KB                         0.207                    29.030      140x
10KB                        0.193                   135.330      700x
50KB                        0.195                   700.320    3,586x
```

StreamJSON's per-chunk cost stays flat. Competitors grow linearly.

## Install

```bash
npm install @a5omic/streamjson
```

## Usage

### Basic streaming (LLM token-by-token)

```javascript
import { StreamJSON } from '@a5omic/streamjson'

const parser = new StreamJSON()

// Feed chunks as they arrive from your LLM
parser.push('{"na')
parser.push('me": "Jo')
parser.push('hn", "age": 30}')
parser.end()

parser.get() // { name: "John", age: 30 }
```

### Partial access mid-stream

```javascript
const parser = new StreamJSON({ emitPartial: true })

parser.push('{"name": "Jo')
parser.get() // { name: "Jo" } — string still being streamed

parser.push('hn", "age": 30}')
parser.end()
parser.get() // { name: "John", age: 30 }
```

### Events

```javascript
const parser = new StreamJSON()

parser.on('value', (path, value, isComplete) => {
  console.log(path, value) // ["name"] "John", ["age"] 30
})

parser.on('object_start', (path) => { /* { opened */ })
parser.on('array_end', (path) => { /* ] closed */ })

parser.push('{"name": "John", "age": 30}')
parser.end()
```

### Static parse (tolerant JSON.parse)

```javascript
// Like JSON.parse but handles trailing commas, truncated input, etc.
StreamJSON.parse('{"a": 1,}') // { a: 1 }
StreamJSON.parse('{"a": "trunc') // { a: "trunc" }
```

### Reset and reuse

```javascript
const parser = new StreamJSON()
parser.push('{"a": 1}')
parser.end()

parser.reset() // ready for next message

parser.push('[1, 2, 3]')
parser.end()
parser.get() // [1, 2, 3]
```

## React

```bash
npm install @a5omic/streamjson-react
```

### Hook

```jsx
import { useStreamJSON } from '@a5omic/streamjson-react'

function Chat() {
  const { push, end, reset, value, isComplete } = useStreamJSON()

  // Feed chunks from your streaming API
  useEffect(() => {
    const stream = fetchLLMStream()
    stream.on('data', (chunk) => push(chunk))
    stream.on('end', () => end())
    return () => reset()
  }, [])

  return <pre>{JSON.stringify(value, null, 2)}</pre>
}
```

### Component

```jsx
import { StreamJSON } from '@a5omic/streamjson-react'

function ToolCall({ streamingJSON, done }) {
  return (
    <StreamJSON content={streamingJSON} complete={done}>
      {(value, isComplete) =>
        value ? <ToolCard tool={value} loading={!isComplete} /> : <Skeleton />
      }
    </StreamJSON>
  )
}
```

## LLM Error Recovery

StreamJSON handles the specific ways LLMs produce malformed JSON:

| Scenario | Input | Output |
|---|---|---|
| Truncated string | `{"name": "Joh` | `{ name: "Joh" }` |
| Truncated number | `{"val": 123` | `{ val: 123 }` |
| Truncated keyword | `{"ok": tru` | `{ ok: true }` |
| Unclosed containers | `{"a": [1, 2` | `{ a: [1, 2] }` |
| Trailing comma | `{"a": 1,}` | `{ a: 1 }` |
| Missing comma | `{"a": 1 "b": 2}` | `{ a: 1, b: 2 }` |

## API

### `new StreamJSON(options?)`

- `emitPartial?: boolean` — Update partial string values in the live object as characters arrive (default: `false`)

### Instance methods

- `push(chunk: string)` — Feed a chunk. O(chunk.length) per call.
- `end()` — Signal stream complete. Flushes pending state, closes open containers.
- `get(): unknown` — Return current parsed value. O(1).
- `reset()` — Clear all state for reuse.
- `on(event, handler)` / `off(event, handler)` — Subscribe to events.

### Events

- `value(path, value, isComplete)` — A value was parsed or updated
- `object_start(path)` / `object_end(path)` — Object opened/closed
- `array_start(path)` / `array_end(path)` — Array opened/closed
- `error(error, position)` — Parse error encountered (recoverable)

### `StreamJSON.parse(json: string): unknown`

Static convenience. Like `JSON.parse` but tolerant of truncated/malformed input.

## Security

- **Prototype pollution immune**: All parsed objects use `Object.create(null)` — no `__proto__`, `constructor`, or `prototype` chain attacks.
- **No regex in hot path**: Zero ReDoS risk.
- **Invalid unicode/escape handling**: Emits error events instead of silently producing corrupt values.

## How it works

StreamJSON is a push-based state machine that processes each byte exactly once. Instead of building an AST, it mutates a live JavaScript object tree directly — the same approach that made [Flowdown](https://github.com/Atomics-hub/flowdown) 2,146x faster than marked for streaming markdown.

**Why competitors are slow:** `partial-json` and similar libraries call `parse(accumulatedString)` on every chunk. At chunk N, they re-parse all N previous chunks. Total work: 1 + 2 + 3 + ... + N = O(N²).

**Why StreamJSON is fast:** Each `push(chunk)` processes only the new bytes and updates the object tree in place. Total work: O(N).

## License

MIT
