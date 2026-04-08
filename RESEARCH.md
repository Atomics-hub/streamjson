# Why Streaming JSON Parsing is Broken

Every AI application that uses structured output — OpenAI function calling, Anthropic tool_use, Vercel AI SDK `streamObject()` — needs to parse JSON as it streams in token by token. The current ecosystem handles this badly.

## The Problem: Accidentally Quadratic

When an LLM streams a JSON response, tokens arrive in small chunks (typically 4-12 bytes). The naive approach — and what every existing library does — is to accumulate all chunks into a string and re-parse the entire thing on every new token:

```
Token 1: parse('{"na')           → 4 bytes parsed
Token 2: parse('{"name"')        → 7 bytes parsed  
Token 3: parse('{"name": "Jo')   → 12 bytes parsed
Token 4: parse('{"name": "John') → 15 bytes parsed
...
Token N: parse(entireString)     → all N bytes parsed again
```

Total work: 4 + 7 + 12 + 15 + ... + N = O(N²).

For a 612-byte LLM response, this means ~18,000 bytes of total parsing work. For a 50KB response, it's ~1.25 billion bytes. The cost grows quadratically with response size.

This is why AI chat interfaces stutter on long structured outputs. It's not the network, it's not the LLM — it's the JSON parser re-doing all previous work on every single token.

## The Existing Libraries

### partial-json (2.1M weekly downloads)

The most popular solution for LLM JSON streaming. It's a recursive descent parser that you call on the accumulated string each time a new token arrives. Clean API, reasonable recovery — but fundamentally O(N²) because it re-parses from the start every time. At 50KB payloads, each call takes ~700μs (and there are thousands of calls).

### jsonrepair (1.36M weekly downloads)

Focused on repairing malformed JSON, not streaming. Even heavier than partial-json because it runs repair heuristics on top of parsing. O(N²) when used for streaming.

### best-effort-json-parser (190K weekly downloads)

Similar to partial-json but with less recovery logic. Still re-parses the full string each time. O(N²).

### Anthropic SDK

Anthropic's SDK accumulates `input_json_delta` events and only delivers the complete JSON after the `content_block_stop` event. This means you cannot display partial structured output mid-stream at all — you have to wait for the entire tool call to finish before showing anything to the user.

### Vercel AI SDK

`streamObject()` re-sends the entire object on each chunk. The SDK doesn't parse incrementally — it re-serializes and re-transmits the growing object. O(N²) in both CPU and bandwidth.

## The Solution: Process Each Byte Exactly Once

StreamJSON takes a fundamentally different approach. Instead of re-parsing, it maintains a state machine that processes each byte exactly once and mutates a live JavaScript object tree in place.

```
Token 1: push('{"na')           → 4 NEW bytes processed
Token 2: push('me"')            → 3 NEW bytes processed
Token 3: push(': "Jo')          → 5 NEW bytes processed
Token 4: push('hn"')            → 3 NEW bytes processed
...
Token N: push(lastChunk)        → only NEW bytes processed
```

Total work: 4 + 3 + 5 + 3 + ... = N bytes total. O(N).

The key insight is that JSON, like markdown, has a natural state machine structure. At any point during parsing, you're in one of a small number of states: expecting a value, inside a string, inside a number, etc. You can save this state between chunks and resume exactly where you left off.

### The State Machine

StreamJSON uses 9 states:

1. **EXPECT_VALUE** — waiting for the start of any JSON value
2. **IN_STRING** — inside a `"..."`, accumulating characters
3. **IN_STRING_ESCAPE** — just saw `\`, next char is escaped
4. **IN_STRING_UNICODE** — inside `\uXXXX`, accumulating hex digits
5. **IN_NUMBER** — accumulating digits, dots, exponents
6. **IN_KEYWORD** — matching `true`, `false`, or `null` character by character
7. **EXPECT_KEY_OR_END** — after `{`, expecting a key string or `}`
8. **EXPECT_COLON** — after a key string, expecting `:`
9. **EXPECT_COMMA_OR_END** — after a value, expecting `,` or `}`/`]`

Each `push(chunk)` iterates over the new bytes, advancing the state machine. No byte is ever processed twice.

### The Live Object Tree

Instead of building an AST and converting it to objects (like traditional parsers), StreamJSON mutates JavaScript objects directly. A stack of "container frames" tracks open objects and arrays. When a value completes, it's assigned to the parent container at the correct key or index.

`get()` returns a reference to the root object — O(1), no reconstruction needed. The caller always sees the latest state of the parse.

### Error Recovery

LLMs produce specific patterns of malformed JSON: truncated strings, incomplete numbers, unclosed containers, trailing commas, missing commas. StreamJSON handles each case:

- **Truncated input**: `end()` flushes pending state — closes open strings, completes numbers, closes all containers
- **Trailing commas**: Silently tolerated (`{"a": 1,}` → `{a: 1}`)
- **Missing commas**: Treated as implicit separators (`{"a": 1 "b": 2}` → `{a: 1, b: 2}`)
- **Invalid numbers**: Assigned as `null` with an error event (no `NaN` or `Infinity` in output)

### Security

All parsed objects use `Object.create(null)` — no prototype chain, immune to `__proto__` pollution. No regex in the hot path (zero ReDoS risk). Invalid unicode escapes emit errors instead of silently producing corrupt values.

## Performance

The O(N) vs O(N²) difference is dramatic at real-world payload sizes:

| Payload | StreamJSON (per chunk) | partial-json (per chunk) | Ratio |
|---------|----------------------|-------------------------|-------|
| 1KB     | 0.27 μs              | 27 μs                   | 100x  |
| 10KB    | 0.21 μs              | 150 μs                  | 700x  |
| 50KB    | 0.22 μs              | 690 μs                  | 3,000x+|

StreamJSON's per-chunk cost stays flat regardless of payload size. Competitors grow linearly (because each chunk re-parses everything before it).

At 50KB — a realistic size for an LLM returning structured data with a few dozen records — StreamJSON is over 3,000x faster per chunk. The difference between a smooth 60fps UI update and visible stuttering.

## Architecture Lineage

StreamJSON follows the same architecture as [Flowdown](https://github.com/Atomics-hub/flowdown), a streaming markdown renderer that achieved 2,146x speedup over marked. Both libraries use:

- Push-based state machine (caller feeds chunks via `push()`)
- No intermediate AST (direct output mutation)
- O(1) per-byte processing (state fully captured between calls)
- Zero dependencies
- Object/frame pooling to reduce GC pressure

The core insight — that streaming formats can be parsed incrementally by maintaining a small, fixed-size state between chunks — applies to any structured text format where the grammar is regular or context-free.
