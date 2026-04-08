import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { StreamJSON, useStreamJSON } from '../packages/react/dist/index.js'

const e = React.createElement

function snapshotValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

describe('streamjson-react', () => {
  let originalConsoleError

  before(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    originalConsoleError = console.error
    console.error = (...args) => {
      const [first] = args
      if (typeof first === 'string' && first.includes('react-test-renderer is deprecated')) return
      originalConsoleError(...args)
    }
  })

  after(() => {
    console.error = originalConsoleError
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  it('useStreamJSON supports push, end, and reset', () => {
    let latest
    function HookHarness(props) {
      latest = useStreamJSON({ emitPartial: props.emitPartial })
      return null
    }

    let renderer
    act(() => {
      renderer = TestRenderer.create(e(HookHarness, { emitPartial: true }))
    })

    act(() => {
      latest.push('{"msg":"he')
    })
    assert.deepEqual(snapshotValue(latest.value), { msg: 'he' })
    assert.equal(latest.isComplete, false)

    act(() => {
      latest.end()
    })
    assert.deepEqual(snapshotValue(latest.value), { msg: 'he' })
    assert.equal(latest.isComplete, true)

    act(() => {
      latest.reset()
    })
    assert.equal(latest.value, undefined)
    assert.equal(latest.isComplete, false)

    act(() => {
      renderer.unmount()
    })
  })

  it('useStreamJSON rebuilds the parser when emitPartial changes', () => {
    let latest
    function HookHarness(props) {
      latest = useStreamJSON({ emitPartial: props.emitPartial })
      return null
    }

    let renderer
    act(() => {
      renderer = TestRenderer.create(e(HookHarness, { emitPartial: false }))
    })

    act(() => {
      latest.push('{"msg":"he')
    })
    assert.deepEqual(snapshotValue(latest.value), {})

    act(() => {
      renderer.update(e(HookHarness, { emitPartial: true }))
    })
    assert.equal(latest.value, undefined)
    assert.equal(latest.isComplete, false)

    act(() => {
      latest.push('{"msg":"he')
    })
    assert.deepEqual(snapshotValue(latest.value), { msg: 'he' })

    act(() => {
      renderer.unmount()
    })
  })

  it('StreamJSON replays current content when emitPartial changes', () => {
    let latestRender
    const children = (value, isComplete) => {
      latestRender = { value: snapshotValue(value), isComplete }
      return null
    }

    let renderer
    act(() => {
      renderer = TestRenderer.create(
        e(StreamJSON, { content: '{"msg":"he', emitPartial: false, complete: false }, children)
      )
    })
    assert.deepEqual(latestRender, { value: {}, isComplete: false })

    act(() => {
      renderer.update(
        e(StreamJSON, { content: '{"msg":"he', emitPartial: true, complete: false }, children)
      )
    })
    assert.deepEqual(latestRender, { value: { msg: 'he' }, isComplete: false })

    act(() => {
      renderer.unmount()
    })
  })

  it('StreamJSON toggles complete without losing current content', () => {
    let latestRender
    const children = (value, isComplete) => {
      latestRender = { value: snapshotValue(value), isComplete }
      return null
    }

    let renderer
    act(() => {
      renderer = TestRenderer.create(
        e(StreamJSON, { content: '{"msg":"he', emitPartial: true, complete: false }, children)
      )
    })
    assert.deepEqual(latestRender, { value: { msg: 'he' }, isComplete: false })

    act(() => {
      renderer.update(
        e(StreamJSON, { content: '{"msg":"he', emitPartial: true, complete: true }, children)
      )
    })
    assert.deepEqual(latestRender, { value: { msg: 'he' }, isComplete: true })

    act(() => {
      renderer.update(
        e(StreamJSON, { content: '{"msg":"he', emitPartial: true, complete: false }, children)
      )
    })
    assert.deepEqual(latestRender, { value: { msg: 'he' }, isComplete: false })

    act(() => {
      renderer.unmount()
    })
  })
})
