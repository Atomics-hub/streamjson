import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { StreamJSON } from '../packages/core/dist/index.js'

function obj(o) {
  return Object.assign(Object.create(null), o)
}

describe('StreamJSON', () => {
  describe('basic types', () => {
    it('parses a string', () => {
      const p = new StreamJSON()
      p.push('"hello"')
      p.end()
      assert.equal(p.get(), 'hello')
    })

    it('parses a number', () => {
      const p = new StreamJSON()
      p.push('42')
      p.end()
      assert.equal(p.get(), 42)
    })

    it('parses negative number', () => {
      assert.equal(StreamJSON.parse('-3.14'), -3.14)
    })

    it('parses scientific notation', () => {
      assert.equal(StreamJSON.parse('1.5e10'), 1.5e10)
    })

    it('parses true', () => {
      assert.equal(StreamJSON.parse('true'), true)
    })

    it('parses false', () => {
      assert.equal(StreamJSON.parse('false'), false)
    })

    it('parses null', () => {
      assert.equal(StreamJSON.parse('null'), null)
    })
  })

  describe('objects', () => {
    it('parses empty object', () => {
      assert.deepEqual(StreamJSON.parse('{}'), obj({}))
    })

    it('parses simple object', () => {
      assert.deepEqual(StreamJSON.parse('{"a": 1, "b": 2}'), obj({ a: 1, b: 2 }))
    })

    it('parses nested objects', () => {
      assert.deepEqual(
        StreamJSON.parse('{"a": {"b": {"c": 1}}}'),
        obj({ a: obj({ b: obj({ c: 1 }) }) })
      )
    })

    it('parses object with mixed types', () => {
      assert.deepEqual(
        StreamJSON.parse('{"s": "hello", "n": 42, "b": true, "x": null}'),
        obj({ s: 'hello', n: 42, b: true, x: null })
      )
    })

    it('objects use null prototype (no prototype pollution)', () => {
      const result = StreamJSON.parse('{}')
      assert.equal(Object.getPrototypeOf(result), null)
    })
  })

  describe('arrays', () => {
    it('parses empty array', () => {
      assert.deepEqual(StreamJSON.parse('[]'), [])
    })

    it('parses number array', () => {
      assert.deepEqual(StreamJSON.parse('[1, 2, 3]'), [1, 2, 3])
    })

    it('parses mixed array', () => {
      assert.deepEqual(
        StreamJSON.parse('[1, "two", true, null, {}]'),
        [1, 'two', true, null, obj({})]
      )
    })

    it('parses nested arrays', () => {
      assert.deepEqual(StreamJSON.parse('[[1, 2], [3, 4]]'), [[1, 2], [3, 4]])
    })
  })

  describe('strings', () => {
    it('handles escape sequences', () => {
      assert.equal(StreamJSON.parse('"a\\nb\\tc"'), 'a\nb\tc')
    })

    it('handles escaped quotes', () => {
      assert.equal(StreamJSON.parse('"he said \\"hi\\""'), 'he said "hi"')
    })

    it('handles escaped backslash', () => {
      assert.equal(StreamJSON.parse('"a\\\\b"'), 'a\\b')
    })

    it('handles unicode escapes', () => {
      assert.equal(StreamJSON.parse('"\\u0048\\u0065\\u006C\\u006C\\u006F"'), 'Hello')
    })

    it('handles surrogate pairs', () => {
      assert.equal(StreamJSON.parse('"\\uD83D\\uDE00"'), '😀')
    })

    it('handles empty string', () => {
      assert.equal(StreamJSON.parse('""'), '')
    })
  })

  describe('streaming (push chunks)', () => {
    it('splits object across chunks', () => {
      const p = new StreamJSON()
      p.push('{"na')
      p.push('me": "Jo')
      p.push('hn", "age": 30}')
      p.end()
      assert.deepEqual(p.get(), obj({ name: 'John', age: 30 }))
    })

    it('splits string across chunks', () => {
      const p = new StreamJSON()
      p.push('"hel')
      p.push('lo wor')
      p.push('ld"')
      p.end()
      assert.equal(p.get(), 'hello world')
    })

    it('splits number across chunks', () => {
      const p = new StreamJSON()
      p.push('12')
      p.push('34')
      p.push('5')
      p.end()
      assert.equal(p.get(), 12345)
    })

    it('splits keyword across chunks', () => {
      const p = new StreamJSON()
      p.push('tr')
      p.push('ue')
      p.end()
      assert.equal(p.get(), true)
    })

    it('single character chunks', () => {
      const json = '{"a": [1, 2]}'
      const p = new StreamJSON()
      for (const ch of json) p.push(ch)
      p.end()
      assert.deepEqual(p.get(), obj({ a: [1, 2] }))
    })

    it('partial string visible mid-stream', () => {
      const p = new StreamJSON({ emitPartial: true })
      p.push('{"name": "Jo')
      assert.deepEqual(p.get(), obj({ name: 'Jo' }))
      p.push('hn"}')
      p.end()
      assert.deepEqual(p.get(), obj({ name: 'John' }))
    })

    it('partial array visible mid-stream', () => {
      const p = new StreamJSON()
      p.push('[1, 2')
      assert.deepEqual(p.get(), [1])
      p.push(', 3]')
      p.end()
      assert.deepEqual(p.get(), [1, 2, 3])
    })
  })

  describe('events', () => {
    it('emits value events', () => {
      const values = []
      const p = new StreamJSON()
      p.on('value', (path, value, isComplete) => {
        values.push({ path: [...path], value, isComplete })
      })
      p.push('{"a": 1, "b": "hi"}')
      p.end()
      assert.equal(values.length, 2)
      assert.deepEqual(values[0], { path: ['a'], value: 1, isComplete: true })
      assert.deepEqual(values[1], { path: ['b'], value: 'hi', isComplete: true })
    })

    it('emits container events', () => {
      const events = []
      const p = new StreamJSON()
      p.on('object_start', (path) => events.push({ type: 'object_start', path: [...path] }))
      p.on('object_end', (path) => events.push({ type: 'object_end', path: [...path] }))
      p.on('array_start', (path) => events.push({ type: 'array_start', path: [...path] }))
      p.on('array_end', (path) => events.push({ type: 'array_end', path: [...path] }))
      p.push('{"items": [1, 2]}')
      p.end()
      assert.equal(events[0].type, 'object_start')
      assert.equal(events[1].type, 'array_start')
      assert.equal(events[2].type, 'array_end')
      assert.equal(events[3].type, 'object_end')
    })

    it('off removes listeners', () => {
      const values = []
      const handler = (path, value) => values.push(value)
      const p = new StreamJSON()
      p.on('value', handler)
      p.push('{"a": 1, ')
      assert.equal(values.length, 1)
      p.off('value', handler)
      p.push('"b": 2}')
      p.end()
      assert.equal(values.length, 1)
    })
  })

  describe('reset', () => {
    it('resets state for reuse', () => {
      const p = new StreamJSON()
      p.push('{"a": 1}')
      p.end()
      assert.deepEqual(p.get(), obj({ a: 1 }))

      p.reset()
      p.push('[1, 2, 3]')
      p.end()
      assert.deepEqual(p.get(), [1, 2, 3])
    })
  })

  describe('whitespace handling', () => {
    it('handles extra whitespace', () => {
      assert.deepEqual(
        StreamJSON.parse('  {  "a"  :  1  ,  "b"  :  2  }  '),
        obj({ a: 1, b: 2 })
      )
    })

    it('handles newlines and tabs', () => {
      assert.deepEqual(
        StreamJSON.parse('{\n\t"a": 1,\n\t"b": 2\n}'),
        obj({ a: 1, b: 2 })
      )
    })
  })

  describe('complex structures', () => {
    it('parses deeply nested structure', () => {
      const json = '{"a": {"b": {"c": {"d": {"e": 42}}}}}'
      assert.deepEqual(StreamJSON.parse(json), obj({ a: obj({ b: obj({ c: obj({ d: obj({ e: 42 }) }) }) }) }))
    })

    it('parses array of objects', () => {
      const json = '[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]'
      assert.deepEqual(StreamJSON.parse(json), [
        obj({ id: 1, name: 'Alice' }),
        obj({ id: 2, name: 'Bob' }),
      ])
    })

    it('parses realistic LLM structured output', () => {
      const json = `{
        "function": "get_weather",
        "arguments": {
          "location": "San Francisco, CA",
          "units": "fahrenheit",
          "forecast_days": 3
        },
        "confidence": 0.95
      }`
      const result = StreamJSON.parse(json)
      assert.equal(result.function, 'get_weather')
      assert.equal(result.arguments.location, 'San Francisco, CA')
      assert.equal(result.confidence, 0.95)
    })
  })
})
