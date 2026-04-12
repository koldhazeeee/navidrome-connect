import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./dataProvider', () => ({
  clientUniqueId: 'tab-device-1',
}))

import { startEventStream } from './eventStream'
import { processEvent, serverDown } from './actions'
import config from './config'

class MockEventSource {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.listeners = {}
    this.onerror = null
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler
  }
  close() {
    this.readyState = 2
  }
}

describe('startEventStream', () => {
  vi.useFakeTimers()
  let dispatch
  let instance
  let instances

  beforeEach(() => {
    dispatch = vi.fn()
    instances = []
    global.EventSource = vi.fn().mockImplementation(function (url) {
      instance = new MockEventSource(url)
      instances.push(instance)
      return instance
    })
    localStorage.setItem('is-authenticated', 'true')
    localStorage.setItem('token', 'abc')
    localStorage.setItem('username', 'alice')
    config.devNewEventStream = true
    // Mock console.log to suppress output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    config.devNewEventStream = false
    vi.clearAllTimers()
  })

  it('reconnects after an error', async () => {
    await startEventStream(dispatch)
    expect(global.EventSource).toHaveBeenCalledTimes(1)
    instance.onerror(new Event('error'))
    expect(dispatch).toHaveBeenCalledWith(serverDown())
    vi.advanceTimersByTime(5000)
    expect(global.EventSource).toHaveBeenCalledTimes(2)
  })

  it('closes the previous stream before opening a new one in legacy mode', async () => {
    config.devNewEventStream = false

    await startEventStream(dispatch)
    const firstInstance = instances[0]

    localStorage.setItem('token', 'def')
    await startEventStream(dispatch)
    const secondInstance = instances[1]

    expect(firstInstance.readyState).toBe(2)
    expect(secondInstance.url).toContain('jwt=def')
  })

  it('includes the client unique id in the event stream URL', async () => {
    await startEventStream(dispatch)

    const streamUrl = new URL(instance.url, 'http://localhost')
    expect(streamUrl.searchParams.get('jwt')).toBe('abc')
    expect(streamUrl.searchParams.get('X-ND-Client-Unique-Id')).toBe(
      'tab-device-1',
    )
  })

  it('ignores connect events for a different user', async () => {
    config.devNewEventStream = false

    await startEventStream(dispatch)
    dispatch.mockClear()

    instance.listeners.connectStateChanged({
      type: 'connectStateChanged',
      data: JSON.stringify({ forUser: 'admin', trackId: 'song-1' }),
    })

    expect(dispatch).not.toHaveBeenCalled()

    instance.listeners.connectStateChanged({
      type: 'connectStateChanged',
      data: JSON.stringify({ forUser: 'alice', trackId: 'song-2' }),
    })

    expect(dispatch).toHaveBeenCalledWith(
      processEvent('connectStateChanged', {
        forUser: 'alice',
        trackId: 'song-2',
      }),
    )
  })
})
