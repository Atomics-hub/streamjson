import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { StreamJSON } from '../packages/core/dist/index.js'

function obj(o) {
  return Object.assign(Object.create(null), o)
}

describe('edge cases', () => {
  describe('LLM error recovery', () => {
    it('handles truncated string', () => {
      const p = new StreamJSON()
      p.push('{"name": "Joh')
      p.end()
      assert.deepEqual(p.get(), obj({ name: 'Joh' }))
    })

    it('handles truncated number', () => {
      const p = new StreamJSON()
      p.push('{"val": 123')
      p.end()
      assert.deepEqual(p.get(), obj({ val: 123 }))
    })

    it('handles truncated keyword true', () => {
      const p = new StreamJSON()
      p.push('{"ok": tru')
      p.end()
      assert.deepEqual(p.get(), obj({ ok: true }))
    })

    it('handles truncated keyword false', () => {
      const p = new StreamJSON()
      p.push('{"ok": fal')
      p.end()
      assert.deepEqual(p.get(), obj({ ok: false }))
    })

    it('handles truncated keyword null', () => {
      const p = new StreamJSON()
      p.push('{"val": nul')
      p.end()
      assert.deepEqual(p.get(), obj({ val: null }))
    })

    it('handles unclosed object', () => {
      const p = new StreamJSON()
      p.push('{"a": 1, "b": 2')
      p.end()
      assert.deepEqual(p.get(), obj({ a: 1, b: 2 }))
    })

    it('handles unclosed array', () => {
      const p = new StreamJSON()
      p.push('[1, 2, 3')
      p.end()
      assert.deepEqual(p.get(), [1, 2, 3])
    })

    it('handles unclosed nested containers', () => {
      const p = new StreamJSON()
      p.push('{"a": [1, {"b": 2')
      p.end()
      assert.deepEqual(p.get(), obj({ a: [1, obj({ b: 2 })] }))
    })

    it('handles trailing comma in object', () => {
      assert.deepEqual(StreamJSON.parse('{"a": 1,}'), obj({ a: 1 }))
    })

    it('handles trailing comma in array', () => {
      assert.deepEqual(StreamJSON.parse('[1, 2,]'), [1, 2])
    })

    it('handles missing comma between object keys', () => {
      assert.deepEqual(StreamJSON.parse('{"a": 1 "b": 2}'), obj({ a: 1, b: 2 }))
    })

    it('ignores content after root JSON completes', () => {
      const p = new StreamJSON()
      p.push('{"a": 1} some extra text')
      p.end()
      assert.deepEqual(p.get(), obj({ a: 1 }))
    })

    it('handles } in EXPECT_VALUE (empty value recovery)', () => {
      assert.deepEqual(StreamJSON.parse('{"a": }'), obj({}))
    })

    it('second root in same chunk does not overwrite first', () => {
      const result = StreamJSON.parse('{"a": 1}{"b": 2}')
      assert.deepEqual(result, obj({ a: 1 }))
    })
  })

  describe('chunk boundary edge cases', () => {
    it('escape split across chunks', () => {
      const p = new StreamJSON()
      p.push('"hello\\')
      p.push('nworld"')
      p.end()
      assert.equal(p.get(), 'hello\nworld')
    })

    it('unicode split across chunks — after backslash-u', () => {
      const p = new StreamJSON()
      p.push('"\\u')
      p.push('0048"')
      p.end()
      assert.equal(p.get(), 'H')
    })

    it('unicode split mid-hex', () => {
      const p = new StreamJSON()
      p.push('"\\u00')
      p.push('48"')
      p.end()
      assert.equal(p.get(), 'H')
    })

    it('surrogate pair split across chunks', () => {
      const p = new StreamJSON()
      p.push('"\\uD83D')
      p.push('\\uDE00"')
      p.end()
      assert.equal(p.get(), '😀')
    })

    it('number ending at chunk boundary', () => {
      const p = new StreamJSON()
      p.push('[42')
      p.push(', 43]')
      p.end()
      assert.deepEqual(p.get(), [42, 43])
    })

    it('colon at chunk boundary', () => {
      const p = new StreamJSON()
      p.push('{"key"')
      p.push(': "val"}')
      p.end()
      assert.deepEqual(p.get(), obj({ key: 'val' }))
    })

    it('opening brace at chunk boundary', () => {
      const p = new StreamJSON()
      p.push('{"a": ')
      p.push('{"b": 1}}')
      p.end()
      assert.deepEqual(p.get(), obj({ a: obj({ b: 1 }) }))
    })
  })

  describe('special values', () => {
    it('handles negative zero', () => {
      assert.equal(StreamJSON.parse('-0'), -0)
    })

    it('handles integer zero', () => {
      assert.equal(StreamJSON.parse('0'), 0)
    })

    it('handles very large numbers', () => {
      assert.equal(StreamJSON.parse('1e308'), 1e308)
    })

    it('handles very small numbers', () => {
      assert.equal(StreamJSON.parse('5e-324'), 5e-324)
    })

    it('handles nested empty containers', () => {
      assert.deepEqual(StreamJSON.parse('[{}, [], {"a": []}]'), [obj({}), [], obj({ a: [] })])
    })

    it('handles string with all escape types', () => {
      assert.equal(
        StreamJSON.parse('"\\"\\\\\\/\\b\\f\\n\\r\\t"'),
        '"\\/\b\f\n\r\t'
      )
    })
  })

  describe('partial string access', () => {
    it('partial string updates in-place with emitPartial', () => {
      const partials = []
      const p = new StreamJSON({ emitPartial: true })
      p.on('value', (path, value, isComplete) => {
        if (!isComplete) partials.push(value)
      })
      p.push('{"msg": "hel')
      p.push('lo"}')
      p.end()
      assert.ok(partials.length > 0)
      assert.equal(partials[0], 'h')
    })

    it('get() reflects partial state without emitPartial', () => {
      const p = new StreamJSON({ emitPartial: true })
      p.push('{"msg": "hel')
      const partial = p.get()
      assert.equal(partial.msg, 'hel')
    })

    it('partial array event paths are correct', () => {
      const events = []
      const p = new StreamJSON({ emitPartial: true })
      p.on('value', (path, value, isComplete) => {
        if (!isComplete) events.push({ path: [...path], value })
      })
      p.push('["ab')
      p.push('c", "de')
      p.push('fg"]')
      p.end()
      // first partial events should be at index 0
      const firstPartials = events.filter(e => e.path[0] === 0)
      assert.ok(firstPartials.length > 0)
      // second element partials should be at index 1
      const secondPartials = events.filter(e => e.path[0] === 1)
      assert.ok(secondPartials.length > 0)
    })
  })

  describe('streaming simulation (random chunks)', () => {
    it('parses complex JSON with random chunk sizes', () => {
      const original = {
        users: [
          { id: 1, name: 'Alice', tags: ['admin', 'user'], active: true },
          { id: 2, name: 'Bob', tags: ['user'], active: false },
        ],
        total: 2,
        page: null,
      }
      const json = JSON.stringify(original)

      for (let trial = 0; trial < 20; trial++) {
        const p = new StreamJSON()
        let i = 0
        while (i < json.length) {
          const chunkSize = Math.max(1, Math.floor(Math.random() * 8))
          p.push(json.slice(i, i + chunkSize))
          i += chunkSize
        }
        p.end()
        // compare stringified since Object.create(null) vs {} would fail deepEqual
        assert.equal(JSON.stringify(p.get()), json)
      }
    })
  })

  describe('static parse', () => {
    it('matches JSON.parse for valid input', () => {
      const cases = [
        '42',
        '"hello"',
        'true',
        'false',
        'null',
        '[]',
        '[1,2,3]',
        '{"a":{"b":[1,2,{"c":true}]}}',
      ]
      for (const c of cases) {
        assert.equal(JSON.stringify(StreamJSON.parse(c)), JSON.stringify(JSON.parse(c)), `Failed for: ${c}`)
      }
    })

    it('empty object matches', () => {
      const result = StreamJSON.parse('{}')
      assert.equal(JSON.stringify(result), '{}')
    })

    it('simple object matches', () => {
      const result = StreamJSON.parse('{"a":1}')
      assert.equal(JSON.stringify(result), '{"a":1}')
    })
  })

  describe('security', () => {
    it('objects use null prototype — immune to prototype pollution', () => {
      const result = StreamJSON.parse('{"__proto__": {"polluted": true}}')
      const plain = {}
      assert.equal(plain.polluted, undefined)
      assert.equal(Object.getPrototypeOf(result), null)
    })

    it('constructor key does not pollute', () => {
      const result = StreamJSON.parse('{"constructor": {"prototype": {"x": 1}}}')
      assert.equal(({}).x, undefined)
    })
  })

  describe('unicode and surrogates', () => {
    it('lone high surrogate followed by literal char is preserved', () => {
      const p = new StreamJSON()
      p.push('"\\uD83D!')
      p.push('"')
      p.end()
      const val = p.get()
      assert.ok(val.includes('!'))
      assert.equal(val.length, 2) // surrogate char + '!'
    })

    it('invalid hex in unicode escape emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('"\\uGGGG"')
      p.end()
      assert.ok(errors.length > 0)
    })

    it('truncated unicode escape reprocesses the closing quote', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('{"a":"\\u00"}')
      p.end()
      assert.ok(errors.some(e => e.includes('Invalid hex digit')))
      assert.deepEqual(p.get(), obj({ a: '' }))
    })
  })

  describe('number validation', () => {
    it('emits error for NaN-producing numbers and assigns null', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('{"x": -}')
      p.end()
      assert.ok(errors.some(e => e.includes('Invalid number')))
      assert.equal(p.get().x, null)
    })

    it('root-level NaN returns null not undefined', () => {
      const p = new StreamJSON()
      p.push('1e')
      p.end()
      assert.equal(p.get(), null)
    })

    it('root-level Infinity returns null not undefined', () => {
      const p = new StreamJSON()
      p.push('1e999')
      p.end()
      assert.equal(p.get(), null)
    })

    it('root-level bare minus returns null', () => {
      const p = new StreamJSON()
      p.push('-')
      p.end()
      assert.equal(p.get(), null)
    })

    it('1e produces error and no NaN in output', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('[1e]')
      p.end()
      assert.ok(errors.some(e => e.includes('Invalid number')))
    })

    it('1e999 produces error (Infinity)', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('1e999')
      p.end()
      assert.ok(errors.some(e => e.includes('Invalid number')))
    })

    it('+/- only valid in exponent context', () => {
      assert.equal(StreamJSON.parse('1e+10'), 1e+10)
      assert.equal(StreamJSON.parse('1E-5'), 1E-5)
    })

    it('leading zero emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('[01]')
      p.end()
      assert.ok(errors.some(e => e.includes('Leading zero')))
      assert.deepEqual(p.get(), [null])
    })

    it('trailing dot emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('0.')
      p.end()
      assert.ok(errors.some(e => e.includes('Trailing dot')))
    })

    it('0.5 still works', () => {
      assert.equal(StreamJSON.parse('0.5'), 0.5)
    })

    it('-0 still works', () => {
      assert.equal(StreamJSON.parse('-0'), -0)
    })

    it('00 triggers leading zero error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('00')
      p.end()
      assert.ok(errors.some(e => e.includes('Leading zero')))
      assert.equal(p.get(), null)
    })

    it('leading zero in object preserves the key with null', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('{"x":01}')
      p.end()
      assert.ok(errors.some(e => e.includes('Leading zero')))
      assert.deepEqual(p.get(), obj({ x: null }))
    })

    it('invalid exponent after decimal assigns null', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('1.e2')
      p.end()
      assert.ok(errors.some(e => e.includes('Invalid number')))
      assert.equal(p.get(), null)
    })

    it('missing integer before decimal assigns null', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('-.1')
      p.end()
      assert.ok(errors.some(e => e.includes('Invalid number')))
      assert.equal(p.get(), null)
    })
  })

  describe('bare structural chars', () => {
    it('bare } emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('}')
      p.end()
      assert.ok(errors.some(e => e.includes('Unexpected }')))
    })

    it('bare ] emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push(']')
      p.end()
      assert.ok(errors.some(e => e.includes('Unexpected ]')))
    })

    it('mismatched ] after an object value emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('{"a":1]')
      p.end()
      assert.ok(errors.some(e => e.includes('Unexpected ]')))
      assert.deepEqual(p.get(), obj({ a: 1 }))
    })

    it('mismatched } after an array value emits error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('[1,2}')
      p.end()
      assert.ok(errors.some(e => e.includes('Unexpected }')))
      assert.deepEqual(p.get(), [1, 2])
    })
  })

  describe('truncated key recovery', () => {
    it('truncated key gets null value', () => {
      const p = new StreamJSON()
      p.push('{"name"')
      p.end()
      assert.deepEqual(p.get(), obj({ name: null }))
    })

    it('truncated key mid-string gets null value', () => {
      const p = new StreamJSON()
      p.push('{"na')
      p.end()
      assert.deepEqual(p.get(), obj({ na: null }))
    })

    it('truncated after colon gets null value', () => {
      const p = new StreamJSON()
      p.push('{"key":')
      p.end()
      assert.deepEqual(p.get(), obj({ key: null }))
    })

    it('truncated after colon with existing key', () => {
      const p = new StreamJSON()
      p.push('{"a": 1, "b":')
      p.end()
      assert.deepEqual(p.get(), obj({ a: 1, b: null }))
    })
  })

  describe('NaN number recovery in objects', () => {
    it('NaN number in object assigns null for key', () => {
      const p = new StreamJSON()
      p.push('{"a": 1e}')
      p.end()
      assert.deepEqual(p.get(), obj({ a: null }))
    })

    it('Infinity number in object assigns null for key', () => {
      const p = new StreamJSON()
      p.push('{"x": 1e999}')
      p.end()
      assert.equal(p.get().x, null)
    })
  })

  describe('NaN in arrays preserves index', () => {
    it('NaN in array assigns null and preserves position', () => {
      const p = new StreamJSON()
      p.push('[1e999, 2, 3]')
      p.end()
      assert.deepEqual(p.get(), [null, 2, 3])
    })

    it('bare minus in array assigns null', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('[-, 2]')
      p.end()
      assert.deepEqual(p.get(), [null, 2])
      assert.ok(errors.length > 0)
    })

    it('1e in array assigns null', () => {
      const p = new StreamJSON()
      p.push('[1e, 2]')
      p.end()
      assert.deepEqual(p.get(), [null, 2])
    })
  })

  describe('listeners survive reset', () => {
    it('value events fire on second parse after reset', () => {
      const values = []
      const p = new StreamJSON()
      p.on('value', (path, val) => values.push(val))
      p.push('{"a": 1}')
      p.end()
      p.reset()
      p.push('{"b": 2}')
      p.end()
      assert.deepEqual(values, [1, 2])
    })
  })

  describe('container event paths', () => {
    it('nested array events have correct paths', () => {
      const events = []
      const p = new StreamJSON()
      p.on('array_start', (path) => events.push({ type: 'start', path: [...path] }))
      p.on('array_end', (path) => events.push({ type: 'end', path: [...path] }))
      p.push('{"items": [[1], [2]]}')
      p.end()
      // outer array at path ["items"]
      assert.deepEqual(events[0], { type: 'start', path: ['items'] })
      // inner arrays at ["items", 0] and ["items", 1]
      assert.deepEqual(events[1], { type: 'start', path: ['items', 0] })
      assert.deepEqual(events[2], { type: 'end', path: ['items', 0] })
      assert.deepEqual(events[3], { type: 'start', path: ['items', 1] })
    })
  })

  describe('single char chunks all types', () => {
    it('handles all JSON types with single char chunks', () => {
      const json = '{"s":"a\\nb","n":42,"b":true,"x":null,"a":[1,{}]}'
      const p = new StreamJSON()
      for (const ch of json) p.push(ch)
      p.end()
      assert.equal(JSON.stringify(p.get()), JSON.stringify(JSON.parse(json)))
    })
  })

  describe('OpenAI tool_calls streaming pattern', () => {
    it('streams nested function call JSON', () => {
      const json = '{"name":"get_weather","arguments":{"location":"SF","units":"celsius"}}'
      const p = new StreamJSON()
      // simulate small chunks like SSE deltas
      const chunkSize = 5
      for (let i = 0; i < json.length; i += chunkSize) {
        p.push(json.slice(i, i + chunkSize))
      }
      p.end()
      const result = p.get()
      assert.equal(result.name, 'get_weather')
      assert.equal(result.arguments.location, 'SF')
      assert.equal(result.arguments.units, 'celsius')
    })
  })

  describe('zero with exponent', () => {
    it('0e5 is valid — no error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('0e5')
      p.end()
      assert.equal(errors.length, 0)
      assert.equal(p.get(), 0)
    })

    it('0E-3 is valid — no error', () => {
      const errors = []
      const p = new StreamJSON()
      p.on('error', (err) => errors.push(err.message))
      p.push('{"x": 0E-3}')
      p.end()
      assert.equal(errors.length, 0)
      assert.equal(p.get().x, 0)
    })

    it('0.0e1 is valid', () => {
      assert.equal(StreamJSON.parse('0.0e1'), 0)
    })
  })
})
