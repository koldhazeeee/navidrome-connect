import { describe, expect, it } from 'vitest'
import { connectSessionReducer } from './connectSessionReducer'
import { EVENT_CONNECT_COMMAND } from '../actions/serverEvents'

describe('connectSessionReducer', () => {
  it('enters follower mode with a paused state when the host is not playing', () => {
    const result = connectSessionReducer(undefined, {
      type: EVENT_CONNECT_COMMAND,
      data: {
        command: 'becomeFollower',
        hostDeviceId: 'host-1',
        trackId: 'song-1',
        positionMs: 2500,
        startPlaying: false,
      },
    })

    expect(result).toMatchObject({
      isFollower: true,
      hostDeviceId: 'host-1',
      trackId: 'song-1',
      positionMs: 2500,
      state: 'paused',
    })
  })

  it('updates follower sync state from connectStateChanged events', () => {
    const initialState = {
      isFollower: true,
      hostDeviceId: 'host-1',
      trackId: 'song-1',
      positionMs: 1000,
      state: 'paused',
      title: null,
      artist: null,
      durationMs: 0,
      playMode: 'order',
    }

    const result = connectSessionReducer(initialState, {
      type: 'connectStateChanged',
      data: {
        trackId: 'song-2',
        title: 'Song 2',
        artist: 'Artist 2',
        state: 'playing',
        positionMs: 3200,
        durationMs: 180000,
        playMode: 'shuffle',
      },
    })

    expect(result).toMatchObject({
      isFollower: true,
      hostDeviceId: 'host-1',
      trackId: 'song-2',
      title: 'Song 2',
      artist: 'Artist 2',
      state: 'playing',
      positionMs: 3200,
      durationMs: 180000,
      playMode: 'shuffle',
    })
  })

  it('ignores sync updates when this device is not following a host', () => {
    const initialState = connectSessionReducer(undefined, {
      type: EVENT_CONNECT_COMMAND,
      data: {
        command: 'becomeHost',
      },
    })

    const result = connectSessionReducer(initialState, {
      type: 'connectStateChanged',
      data: {
        trackId: 'song-2',
        state: 'playing',
      },
    })

    expect(result).toEqual(initialState)
  })
})
