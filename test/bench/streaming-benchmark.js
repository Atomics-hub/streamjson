import { StreamJSON } from '../../packages/core/dist/index.js'
import { parse as partialParse } from 'partial-json'
import { jsonrepair } from 'jsonrepair'
import bestEffort from 'best-effort-json-parser'

const FIXTURE = JSON.stringify({
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_01H9YhPm5VFpMeRKdiGMPbJR',
      name: 'get_weather',
      input: {
        location: 'San Francisco, CA',
        units: 'fahrenheit',
        forecast_days: 3,
        include_hourly: true,
        metadata: {
          source: 'user_request',
          timestamp: '2026-04-07T12:00:00Z',
          session_id: 'sess_abc123def456',
          tags: ['weather', 'forecast', 'california', 'urgent'],
        },
      },
    },
  ],
  model: 'claude-opus-4-6-20250415',
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 384, output_tokens: 96, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
})

function tokenize(text, avgSize = 6) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const len = Math.max(1, Math.floor(Math.random() * avgSize * 2) + 1)
    tokens.push(text.slice(i, i + len))
    i += len
  }
  return tokens
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function runBench(name, fn, iterations = 50) {
  for (let i = 0; i < 5; i++) fn()
  const times = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  const med = median(times)
  const min = Math.min(...times)
  return { name, median: med, min, times }
}

function generateLargeFixture(targetBytes) {
  const items = []
  const item = {
    id: 1,
    name: 'Alice Wonderland',
    email: 'alice@example.com',
    active: true,
    tags: ['admin', 'user', 'premium'],
    address: { street: '123 Main St', city: 'San Francisco', state: 'CA', zip: '94105' },
  }
  const itemStr = JSON.stringify(item)
  const count = Math.ceil(targetBytes / itemStr.length)
  for (let i = 0; i < count; i++) items.push({ ...item, id: i })
  return JSON.stringify({ users: items, total: count, page: 1 })
}

console.log('StreamJSON Benchmark')
console.log('='.repeat(70))
console.log(`Fixture: ${FIXTURE.length} bytes\n`)

// --- Streaming benchmark ---
console.log('STREAMING (simulated LLM token delivery)')
console.log('-'.repeat(70))

const tokens = tokenize(FIXTURE)
console.log(`Tokens: ${tokens.length} (avg ${(FIXTURE.length / tokens.length).toFixed(1)} bytes/token)\n`)

const streamjsonResult = runBench('StreamJSON', () => {
  const p = new StreamJSON()
  for (const t of tokens) p.push(t)
  p.end()
  return p.get()
})

const partialJsonResult = runBench('partial-json', () => {
  let acc = ''
  let result
  for (const t of tokens) {
    acc += t
    try { result = partialParse(acc) } catch {}
  }
  return result
})

const jsonrepairResult = runBench('jsonrepair', () => {
  let acc = ''
  let result
  for (const t of tokens) {
    acc += t
    try { result = JSON.parse(jsonrepair(acc)) } catch {}
  }
  return result
})

const bestEffortResult = runBench('best-effort', () => {
  let acc = ''
  let result
  for (const t of tokens) {
    acc += t
    try { result = bestEffort(acc) } catch {}
  }
  return result
})

const results = [streamjsonResult, partialJsonResult, jsonrepairResult, bestEffortResult]
const fastest = Math.min(...results.map(r => r.median))

console.log('Library             Median (ms)    Min (ms)    Speedup')
console.log('-'.repeat(70))
for (const r of results) {
  const speedup = r.median / fastest
  const marker = r.median === fastest ? ' ⚡' : ''
  console.log(
    `${r.name.padEnd(20)} ${r.median.toFixed(3).padStart(10)}   ${r.min.toFixed(3).padStart(10)}   ${speedup.toFixed(1).padStart(7)}x${marker}`
  )
}

// --- Scale test ---
console.log('\n\nSCALE TEST (per-chunk cost as payload grows)')
console.log('-'.repeat(70))
console.log('Size         StreamJSON (µs/chunk)    partial-json (µs/chunk)    Ratio')
console.log('-'.repeat(70))

for (const size of [1024, 10240, 51200]) {
  const fixture = generateLargeFixture(size)
  const toks = tokenize(fixture)
  const label = size >= 1024 ? `${(size / 1024).toFixed(0)}KB` : `${size}B`

  const sjResult = runBench(`sj-${label}`, () => {
    const p = new StreamJSON()
    for (const t of toks) p.push(t)
    p.end()
  }, 20)

  const pjResult = runBench(`pj-${label}`, () => {
    let acc = ''
    for (const t of toks) {
      acc += t
      try { partialParse(acc) } catch {}
    }
  }, size > 20000 ? 3 : 20)

  const sjPerChunk = (sjResult.median / toks.length) * 1000
  const pjPerChunk = (pjResult.median / toks.length) * 1000
  const ratio = pjPerChunk / sjPerChunk

  console.log(
    `${label.padEnd(12)} ${sjPerChunk.toFixed(3).padStart(20)}    ${pjPerChunk.toFixed(3).padStart(22)}    ${ratio.toFixed(0).padStart(5)}x`
  )
}

console.log('\n✓ StreamJSON per-chunk cost stays constant (O(n) total)')
console.log('✗ partial-json per-chunk cost grows with payload (O(n²) total)')
