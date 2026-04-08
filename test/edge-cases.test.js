import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { StreamJSON } from '../packages/core/dist/index.js'

describe('edge cases', () => {
  describe('LLM error recovery', () => {
    it('handles truncated string', () => {
      const p = new StreamJSON()
      p.push('{"name": "Joh')
      p.end()
      assert.deepEqual(p.get(), { name: 'Joh' })
    })

    it('handles truncated number', () => {
      const p = new StreamJSON()
      p.push('{"val": 123')
      p.end()
      assert.deepEqual(p.get(), { val: 123 })
    })

    it('handles truncated keyword true', () => {
      const p = new StreamJSON()
      p.push('{"ok": tru')
      p.end()
      assert.deepEqual(p.get(), { ok: true })
    })

    it('handles truncated keyword false', () => {
      const p = new StreamJSON()
      p.push('{"ok": fal')
      p.end()
      assert.deepEqual(p.get(), { ok: false })
    })

    it('handles truncated keyword null', () => {
      const p = new StreamJSON()
      p.push('{"val": nul')
      p.end()
      assert.deepEqual(p.get(), { val: null })
    })

    it('handles unclosed object', () => {
      const p = new StreamJSON()
      p.push('{"a": 1, "b": 2')
      p.end()
      assert.deepEqual(p.get(), { a: 1, b: 2 })
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
      assert.deepEqual(p.get(), { a: [1, { b: 2 }] })
    })

    it('handles trailing comma in object', () => {
      assert.deepEqual(StreamJSON.parse('{"a": 1,}'), { a: 1 })
    })

    it('handles trailing comma in array', () => {
      assert.deepEqual(StreamJSON.parse('[1, 2,]'), [1, 2])
    })

    it('handles missing comma between object keys', () => {
      assert.deepEqual(StreamJSON.parse('{"a": 1 "b": 2}'), { a: 1, b: 2 })
    })

    it('ignores content after root JSON completes', () => {
      const p = new StreamJSON()
      p.push('{"a": 1} some extra text')
      p.end()
      assert.deepEqual(p.get(), { a: 1 })
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
      assert.deepEqual(p.get(), { key: 'val' })
    })

    it('opening brace at chunk boundary', () => {
      const p = new StreamJSON()
      p.push('{"a": ')
      p.push('{"b": 1}}')
      p.end()
      assert.deepEqual(p.get(), { a: { b: 1 } })
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
      assert.deepEqual(StreamJSON.parse('[{}, [], {"a": []}]'), [{}, [], { a: [] }])
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
  })

  describe('streaming simulation (random chunks)', () => {
    it('parses complex JSON with random chunk sizes', () => {
      const json = JSON.stringify({
        users: [
          { id: 1, name: 'Alice', tags: ['admin', 'user'], active: true },
          { id: 2, name: 'Bob', tags: ['user'], active: false },
        ],
        total: 2,
        page: null,
      })

      for (let trial = 0; trial < 20; trial++) {
        const p = new StreamJSON()
        let i = 0
        while (i < json.length) {
          const chunkSize = Math.max(1, Math.floor(Math.random() * 8))
          p.push(json.slice(i, i + chunkSize))
          i += chunkSize
        }
        p.end()
        assert.deepEqual(p.get(), JSON.parse(json))
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
        '{}',
        '[1,2,3]',
        '{"a":1}',
        '{"a":{"b":[1,2,{"c":true}]}}',
      ]
      for (const c of cases) {
        assert.deepEqual(StreamJSON.parse(c), JSON.parse(c), `Failed for: ${c}`)
      }
    })
  })
})
