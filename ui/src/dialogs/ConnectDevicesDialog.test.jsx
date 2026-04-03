import React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectDevicesDialog } from './ConnectDevicesDialog'

const mocks = vi.hoisted(() => ({
  connectDebug: vi.fn(),
  dispatch: vi.fn(),
  httpClient: vi.fn(),
  notify: vi.fn(),
  state: {
    connectDevicesDialog: { open: true },
    connectSession: { isFollower: false, hostDeviceId: null },
    player: { current: { trackId: 'track-1' } },
  },
  url: vi.fn((endpoint, _resource, params) => {
    if (endpoint === 'getConnectDevices') {
      return '/rest/getConnectDevices.view'
    }
    if (endpoint === 'transferPlayback') {
      return `/rest/transferPlayback.view?deviceId=${params.deviceId}`
    }
    if (endpoint === 'sendConnectCommand') {
      return `/rest/sendConnectCommand.view?deviceId=${params.deviceId}&command=${params.command}`
    }
    if (endpoint === 'setDeviceNickname') {
      return `/rest/setDeviceNickname.view?deviceId=${params.deviceId}&nickname=${encodeURIComponent(params.nickname)}`
    }
    return null
  }),
}))

vi.mock('react-redux', () => ({
  useDispatch: () => mocks.dispatch,
  useSelector: (selector) => selector(mocks.state),
}))

vi.mock('react-admin', () => ({
  useNotify: () => mocks.notify,
  useTranslate: () => (_key, options) => options?._ ?? _key,
}))

vi.mock('../actions', () => ({
  closeConnectDevicesDialog: () => ({ type: 'CLOSE_CONNECT_DEVICES_DIALOG' }),
}))

vi.mock('../dataProvider', () => ({
  clientUniqueId: 'current-device',
  httpClient: (...args) => mocks.httpClient(...args),
}))

vi.mock('../subsonic', () => ({
  default: {
    url: (...args) => mocks.url(...args),
  },
}))

vi.mock('../utils/connectDebug', () => ({
  default: (...args) => mocks.connectDebug(...args),
}))

describe('<ConnectDevicesDialog />', () => {
  const devicesPayload = {
    'subsonic-response': {
      connectDevices: {
        hostDeviceId: 'host-device',
        device: [
          {
            id: 'host-device',
            name: 'Host Speaker',
            client: 'host-device',
            isOnline: true,
            nowPlaying: {
              trackId: 'track-1',
              title: 'Track 1',
              artist: 'Artist 1',
              state: 'playing',
              positionMs: 1500,
              durationMs: 210000,
            },
          },
          {
            id: 'current-device',
            name: 'Current Device',
            client: 'current-device',
            isOnline: true,
          },
        ],
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.connectDevicesDialog = { open: true }
    mocks.state.connectSession = { isFollower: false, hostDeviceId: null }
    mocks.state.player = { current: { trackId: 'track-1' } }
    mocks.httpClient.mockImplementation(() =>
      Promise.resolve({ json: { 'subsonic-response': {} } }),
    )
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('uses the current host playback position when transferring to another device', async () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      value: 42.345,
      writable: true,
    })
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      value: false,
    })
    Object.defineProperty(audio, 'ended', {
      configurable: true,
      value: false,
    })
    document.body.appendChild(audio)

    mocks.state.connectSession = {
      isFollower: false,
      hostDeviceId: 'current-device',
    }
    mocks.httpClient
      .mockResolvedValueOnce({
        json: {
          'subsonic-response': {
            connectDevices: {
              hostDeviceId: 'current-device',
              device: [
                {
                  id: 'current-device',
                  name: 'Current Device',
                  client: 'current-device',
                  isOnline: true,
                  nowPlaying: {
                    trackId: 'track-1',
                    title: 'Track 1',
                    artist: 'Artist 1',
                    state: 'playing',
                    positionMs: 1500,
                    durationMs: 210000,
                  },
                },
                {
                  id: 'living-room',
                  name: 'Living Room',
                  client: 'living-room',
                  isOnline: true,
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({ json: { 'subsonic-response': {} } })

    render(<ConnectDevicesDialog />)

    expect(await screen.findByText('Current Device')).toBeInTheDocument()
    expect(screen.getByTestId('transfer-living-room')).toBeInTheDocument()
    expect(screen.queryByTestId('take-over')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('transfer-living-room'))

    await waitFor(() => {
      expect(mocks.url).toHaveBeenCalledWith('transferPlayback', null, {
        deviceId: 'living-room',
        id: 'track-1',
        positionMs: 42345,
        startPlaying: true,
      })
    })
  })

  it('shows take over on the host row when the current device is following', async () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      value: 59.194,
      writable: true,
    })
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      value: false,
    })
    Object.defineProperty(audio, 'ended', {
      configurable: true,
      value: false,
    })
    document.body.appendChild(audio)

    mocks.state.connectSession = {
      isFollower: true,
      hostDeviceId: 'host-device',
    }
    mocks.httpClient
      .mockResolvedValueOnce({ json: devicesPayload })
      .mockResolvedValueOnce({ json: { 'subsonic-response': {} } })

    render(<ConnectDevicesDialog />)

    expect(await screen.findByTestId('take-over')).toBeInTheDocument()
    expect(screen.queryByTestId('transfer-host-device')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('transfer-current-device'),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('take-over'))

    await waitFor(() => {
      expect(mocks.url).toHaveBeenCalledWith('transferPlayback', null, {
        deviceId: 'current-device',
        id: 'track-1',
        positionMs: 59194,
        startPlaying: true,
      })
    })
    await waitFor(() => {
      expect(mocks.httpClient).toHaveBeenCalledWith(
        '/rest/transferPlayback.view?deviceId=current-device',
      )
    })
  })

  it('logs the timer position it renders for the host device', async () => {
    mocks.httpClient.mockResolvedValueOnce({ json: devicesPayload })

    render(<ConnectDevicesDialog />)

    expect(await screen.findByText('Host Speaker')).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.connectDebug).toHaveBeenCalledWith(
        'device timer fetched',
        expect.objectContaining({
          deviceId: 'host-device',
          isHost: true,
          positionMs: 1500,
          formattedPosition: '0:01',
          formattedDuration: '3:30',
        }),
      )
    })
    expect(mocks.connectDebug).toHaveBeenCalledWith(
      'device timer render',
      expect.objectContaining({
        deviceId: 'host-device',
        isHost: true,
        positionMs: 1500,
        renderedPosition: '0:01',
        renderedDuration: '3:30',
      }),
    )
  })

  it('saves a device nickname from the dialog', async () => {
    mocks.httpClient
      .mockResolvedValueOnce({ json: devicesPayload })
      .mockResolvedValueOnce({ json: { 'subsonic-response': {} } })
      .mockResolvedValueOnce({
        json: {
          'subsonic-response': {
            connectDevices: {
              hostDeviceId: 'host-device',
              device: [
                devicesPayload['subsonic-response'].connectDevices.device[0],
                {
                  id: 'current-device',
                  name: 'Bedroom',
                  client: 'current-device',
                  isOnline: true,
                },
              ],
            },
          },
        },
      })

    render(<ConnectDevicesDialog />)

    expect(await screen.findByText('Current Device')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('edit-nickname-current-device'))
    fireEvent.change(screen.getByTestId('nickname-input-current-device'), {
      target: { value: 'Bedroom' },
    })
    fireEvent.click(screen.getByTestId('save-nickname-current-device'))

    await waitFor(() => {
      expect(mocks.url).toHaveBeenCalledWith('setDeviceNickname', null, {
        deviceId: 'current-device',
        nickname: 'Bedroom',
      })
    })
    await waitFor(() => {
      expect(mocks.httpClient).toHaveBeenCalledWith(
        '/rest/setDeviceNickname.view?deviceId=current-device&nickname=Bedroom',
      )
    })
  })
})
