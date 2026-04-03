import { describe, expect, it } from 'vitest'
import { connectCommandReducer } from './connectCommandReducer'
import { EVENT_CONNECT_COMMAND } from '../actions/serverEvents'

describe('connectCommandReducer', () => {
  it('stores the latest command and increments the sequence number', () => {
    const first = connectCommandReducer(undefined, {
      type: EVENT_CONNECT_COMMAND,
      data: { command: 'play' },
    })

    const second = connectCommandReducer(first, {
      type: EVENT_CONNECT_COMMAND,
      data: { command: 'pause' },
    })

    expect(first).toEqual({
      command: { command: 'play' },
      seq: 1,
    })
    expect(second).toEqual({
      command: { command: 'pause' },
      seq: 2,
    })
  })

  it('ignores unrelated events', () => {
    const state = connectCommandReducer(undefined, {
      type: 'somethingElse',
      data: { command: 'play' },
    })

    expect(state).toEqual({
      command: null,
      seq: 0,
    })
  })
})
