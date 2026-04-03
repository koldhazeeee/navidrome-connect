import { beforeEach, describe, expect, it, vi } from 'vitest'
import connectMiddleware from './connectMiddleware'
import {
  PLAYER_PLAY_TRACKS,
  PLAYER_SET_MODE,
  PLAYER_SET_TRACK,
  PLAYER_SET_VOLUME,
} from '../actions'
import { httpClient } from '../dataProvider'
import subsonic from '../subsonic'

vi.mock('../dataProvider', () => ({
  httpClient: vi.fn(),
}))

vi.mock('../subsonic', () => ({
  default: {
    url: vi.fn(() => '/rest/sendConnectCommand.view'),
  },
}))

describe('connectMiddleware', () => {
  const next = vi.fn()

  const invoke = (state, action) =>
    connectMiddleware({ getState: () => state })(next)(action)

  beforeEach(() => {
    vi.clearAllMocks()
    httpClient.mockResolvedValue({})
  })

  it('passes actions through when the device is not following a host', () => {
    const action = { type: 'OTHER_ACTION' }

    invoke(
      { connectSession: { isFollower: false, hostDeviceId: null } },
      action,
    )

    expect(next).toHaveBeenCalledWith(action)
    expect(httpClient).not.toHaveBeenCalled()
  })

  it('forwards queue replacement to the host device', () => {
    invoke(
      { connectSession: { isFollower: true, hostDeviceId: 'host-1' } },
      {
        type: PLAYER_PLAY_TRACKS,
        data: {
          'song-1': { id: 'song-1' },
          'song-2': { id: 'song-2' },
        },
        id: 'song-2',
      },
    )

    expect(subsonic.url).toHaveBeenCalledWith('sendConnectCommand', null, {
      deviceId: 'host-1',
      command: 'setQueue',
      id: ['song-1', 'song-2'],
      selectedId: 'song-2',
    })
    expect(httpClient).toHaveBeenCalledWith('/rest/sendConnectCommand.view')
    expect(next).not.toHaveBeenCalled()
  })

  it('forwards selecting a single track to the host as a queue update', () => {
    invoke(
      { connectSession: { isFollower: true, hostDeviceId: 'host-1' } },
      {
        type: PLAYER_SET_TRACK,
        data: { id: 'song-9' },
      },
    )

    expect(subsonic.url).toHaveBeenCalledWith('sendConnectCommand', null, {
      deviceId: 'host-1',
      command: 'setQueue',
      id: ['song-9'],
      selectedId: 'song-9',
    })
    expect(httpClient).toHaveBeenCalledWith('/rest/sendConnectCommand.view')
  })

  it('forwards volume and play mode changes to the host device', () => {
    invoke(
      { connectSession: { isFollower: true, hostDeviceId: 'host-1' } },
      {
        type: PLAYER_SET_VOLUME,
        data: { volume: 0.65 },
      },
    )
    invoke(
      { connectSession: { isFollower: true, hostDeviceId: 'host-1' } },
      {
        type: PLAYER_SET_MODE,
        data: { mode: 'shuffle' },
      },
    )

    expect(subsonic.url).toHaveBeenNthCalledWith(
      1,
      'sendConnectCommand',
      null,
      {
        deviceId: 'host-1',
        command: 'setVolume',
        volume: 65,
      },
    )
    expect(subsonic.url).toHaveBeenNthCalledWith(
      2,
      'sendConnectCommand',
      null,
      {
        deviceId: 'host-1',
        command: 'setPlayMode',
        playMode: 'shuffle',
      },
    )
    expect(httpClient).toHaveBeenCalledTimes(2)
  })
})
