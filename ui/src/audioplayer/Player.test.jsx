import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Player } from './Player'
import { httpClient } from '../dataProvider'
import subsonic from '../subsonic'
import { decisionService } from '../transcode'

let playerProps
const mockDispatch = vi.fn()
const mockSeekGuard = vi.fn()
const mockDataProvider = { getOne: vi.fn(() => Promise.resolve({ data: {} })) }
const mockAudioInstance = {
  currentTime: 0,
  paused: false,
  readyState: 3,
  volume: 1,
  muted: false,
  play: vi.fn(() => {
    mockAudioInstance.paused = false
    return Promise.resolve()
  }),
  pause: vi.fn(() => {
    mockAudioInstance.paused = true
  }),
}

const createPlayerState = () => ({
  queue: [
    {
      uuid: 'uuid-1',
      trackId: 'track-1',
      isRadio: false,
      song: { title: 'Song', artist: 'Artist', album: 'Album' },
    },
  ],
  current: {
    uuid: 'uuid-1',
    trackId: 'track-1',
    isRadio: false,
    song: { title: 'Song', artist: 'Artist', album: 'Album' },
  },
  mode: 'order',
  volume: 1,
  autoPlay: true,
  clear: false,
  playIndex: 0,
  savedPlayIndex: 0,
})

const createConnectSession = () => ({
  isFollower: false,
  hostDeviceId: null,
  trackId: null,
  positionMs: 0,
  state: null,
  title: null,
  artist: null,
  playMode: null,
})

const mockState = {
  player: createPlayerState(),
  replayGain: { gainMode: 'off' },
  settings: { notifications: false },
  connectCommand: null,
  connectSession: createConnectSession(),
}

vi.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector) => selector(mockState),
}))

vi.mock('@material-ui/core', () => ({
  useMediaQuery: () => false,
}))

vi.mock('react-admin', () => ({
  createMuiTheme: (theme) => theme,
  useAuthState: () => ({ authenticated: true }),
  useDataProvider: () => mockDataProvider,
  useTranslate: () => (key) => key,
}))

vi.mock('react-hotkeys', () => ({
  GlobalHotKeys: () => null,
}))

vi.mock('navidrome-music-player', () => ({
  default: (props) => {
    playerProps = props
    return <div data-testid="mock-player" />
  },
}))

vi.mock('../dataProvider', () => ({
  clientUniqueId: 'current-device',
  httpClient: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../subsonic', () => ({
  default: {
    url: vi.fn(() => '/rest/sendConnectCommand.view'),
    reportPlayback: vi.fn(),
    scrobble: vi.fn(),
  },
}))

vi.mock('../themes/useCurrentTheme', () => ({
  default: () => ({ player: { theme: 'dark' } }),
}))

vi.mock('./styles', () => ({
  default: () => ({ player: 'player' }),
}))

vi.mock('./AudioTitle', () => ({
  default: () => null,
}))

vi.mock('./PlayerToolbar', () => ({
  default: () => null,
}))

vi.mock('./locale', () => ({
  default: () => ({}),
}))

vi.mock('./keyHandlers', () => ({
  default: () => ({}),
}))

vi.mock('../transcode', () => ({
  detectBrowserProfile: () => ({}),
  decisionService: {
    setProfile: vi.fn(),
    resolveStreamUrl: vi.fn(() => Promise.resolve('/stream')),
    prefetchDecisions: vi.fn(),
    invalidateAll: vi.fn(),
  },
}))

vi.mock('../actions', () => ({
  clearQueue: vi.fn(() => ({ type: 'CLEAR_QUEUE' })),
  currentPlaying: vi.fn((info) => ({ type: 'CURRENT_PLAYING', payload: info })),
  playTracks: vi.fn((data, ids, selectedId) => ({
    type: 'PLAY_TRACKS',
    payload: { data, ids, selectedId },
  })),
  refreshQueue: vi.fn((payload) => ({ type: 'REFRESH_QUEUE', payload })),
  setFollowerTrack: vi.fn((data, silentSrc) => ({
    type: 'SET_FOLLOWER_TRACK',
    payload: { data, silentSrc },
  })),
  setPlayMode: vi.fn((payload) => ({ type: 'SET_PLAY_MODE', payload })),
  setTrack: vi.fn((payload) => ({ type: 'SET_TRACK', payload })),
  setTranscodingProfile: vi.fn((payload) => ({
    type: 'SET_TRANSCODING_PROFILE',
    payload,
  })),
  setVolume: vi.fn((payload) => ({ type: 'SET_VOLUME', payload })),
  syncQueue: vi.fn((audioInfo, audioLists) => ({
    type: 'SYNC_QUEUE',
    payload: { audioInfo, audioLists },
  })),
}))

vi.mock('../utils', () => ({
  sendNotification: vi.fn(),
}))

vi.mock('../utils/silentAudio', () => ({
  createSilentBlobUrl: vi.fn(() => 'blob:silent'),
}))

vi.mock('./useTabSwitchSeekGuard', () => ({
  useTabSwitchSeekGuard: () => mockSeekGuard,
}))

describe('<Player />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    playerProps = undefined
    mockDataProvider.getOne.mockResolvedValue({ data: {} })
    mockAudioInstance.currentTime = 0
    mockAudioInstance.paused = false
    mockAudioInstance.readyState = 3
    mockAudioInstance.muted = false
    mockAudioInstance.play.mockImplementation(() => {
      mockAudioInstance.paused = false
      return Promise.resolve()
    })
    mockAudioInstance.pause.mockImplementation(() => {
      mockAudioInstance.paused = true
    })
    mockState.player = createPlayerState()
    mockState.connectCommand = null
    mockState.connectSession = createConnectSession()
    document.title = 'Navidrome'
    httpClient.mockResolvedValue({})
  })

  const renderPlayer = async () => {
    render(<Player />)
    await waitFor(() => expect(playerProps).toBeDefined())
  }

  it('reports playback state when audio starts', async () => {
    await renderPlayer()

    act(() => {
      playerProps.onAudioPlay({
        trackId: 'track-1',
        currentTime: 42.4,
        duration: 180,
        isRadio: false,
        song: { title: 'Song', artist: 'Artist', album: 'Album' },
        cover: '/cover',
      })
    })

    expect(subsonic.reportPlayback).toHaveBeenCalledWith(
      'track-1',
      42400,
      'playing',
      1.0,
      true,
    )
  })

  it('reports playback state when audio pauses', async () => {
    await renderPlayer()

    act(() => {
      playerProps.onAudioPause({
        trackId: 'track-1',
        currentTime: 12.3,
        isRadio: false,
      })
    })

    expect(subsonic.reportPlayback).toHaveBeenCalledWith(
      'track-1',
      12300,
      'paused',
      1.0,
      true,
    )
  })

  it('does not forward follower pause events while the tab is hidden', async () => {
    mockState.connectSession = {
      ...createConnectSession(),
      isFollower: true,
      hostDeviceId: 'host-device',
    }

    await renderPlayer()
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    act(() => {
      playerProps.onAudioPause({
        trackId: 'track-1',
        currentTime: 12.3,
        isRadio: false,
      })
    })

    expect(subsonic.url).not.toHaveBeenCalled()
    expect(httpClient).not.toHaveBeenCalled()
  })

  it('does not forward pause or stop during follower transfer handoff', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    mockState.connectSession = {
      ...createConnectSession(),
      isFollower: true,
      hostDeviceId: 'new-host-device',
      trackId: 'track-2',
      positionMs: 48437,
      state: 'playing',
      title: 'Lean Wit Me',
      artist: 'Juice WRLD',
      playMode: 'order',
    }
    mockDataProvider.getOne.mockResolvedValueOnce({
      data: {
        id: 'track-2',
        title: 'Lean Wit Me',
        artist: 'Juice WRLD',
        album: 'Album',
        duration: 215,
      },
    })

    try {
      await renderPlayer()
      await waitFor(() => expect(mockDataProvider.getOne).toHaveBeenCalled())

      act(() => {
        playerProps.onAudioPause({
          trackId: 'track-2',
          currentTime: 48.437,
          isRadio: false,
        })
        playerProps.onAudioEnded('uuid-1', [], {
          trackId: 'track-2',
          currentTime: 48.437,
          isRadio: false,
        })
      })

      expect(subsonic.url).not.toHaveBeenCalled()
      expect(httpClient).not.toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('resumes a paused follower when the tab becomes visible again', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    mockState.connectSession = {
      ...createConnectSession(),
      isFollower: true,
      hostDeviceId: 'host-device',
      trackId: 'track-1',
      positionMs: 12000,
      state: 'playing',
    }

    mockAudioInstance.paused = true
    nowSpy.mockReturnValue(1000)

    await renderPlayer()

    act(() => {
      playerProps.getAudioInstance(mockAudioInstance)
    })

    nowSpy.mockReturnValue(6000)
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(mockAudioInstance.currentTime).toBe(17))
    await waitFor(() => expect(mockAudioInstance.play).toHaveBeenCalled())

    nowSpy.mockRestore()
  })

  it('reports seek position changes', async () => {
    await renderPlayer()
    const initialOnAudioSeeked = playerProps.onAudioSeeked

    act(() => {
      playerProps.getAudioInstance(mockAudioInstance)
    })

    await waitFor(() =>
      expect(playerProps.onAudioSeeked).not.toBe(initialOnAudioSeeked),
    )

    mockAudioInstance.currentTime = 88.2
    mockAudioInstance.paused = false

    act(() => {
      playerProps.onAudioSeeked()
    })

    expect(mockSeekGuard).toHaveBeenCalled()
    expect(subsonic.reportPlayback).toHaveBeenCalledWith(
      'track-1',
      88200,
      'playing',
      1.0,
      true,
    )
  })

  it('reports playback after applying a remote seek command on the host', async () => {
    mockState.connectCommand = {
      command: { command: 'seek', positionMs: 45000 },
      seq: 1,
    }

    await renderPlayer()
    subsonic.reportPlayback.mockClear()

    act(() => {
      playerProps.getAudioInstance(mockAudioInstance)
    })

    await waitFor(() => expect(mockAudioInstance.currentTime).toBe(45))
    expect(subsonic.reportPlayback).toHaveBeenCalledWith(
      'track-1',
      45000,
      'playing',
      1.0,
      true,
    )
  })

  it('starts becomeHost playback while the tab is hidden', async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 1)
    mockState.connectCommand = {
      command: {
        command: 'becomeHost',
        trackId: 'track-1',
        positionMs: 1234,
        startPlaying: true,
      },
      seq: 1,
    }
    mockDataProvider.getOne.mockResolvedValueOnce({
      data: {
        id: 'track-1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
      },
    })
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })

    try {
      await renderPlayer()

      act(() => {
        playerProps.getAudioInstance(mockAudioInstance)
      })

      await waitFor(() => expect(mockAudioInstance.play).toHaveBeenCalled())
      await waitFor(() => expect(mockAudioInstance.currentTime).toBe(1.234))
    } finally {
      requestAnimationFrameSpy.mockRestore()
    }
  })

  it('does not replay a stale becomeHost command after a local host track change', async () => {
    let resolveTrack
    mockState.connectCommand = {
      command: {
        command: 'becomeHost',
        trackId: 'track-1',
        positionMs: 0,
        startPlaying: true,
      },
      seq: 1,
    }
    mockDataProvider.getOne.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTrack = resolve
      }),
    )

    const view = render(<Player />)
    await waitFor(() => expect(playerProps).toBeDefined())
    await waitFor(() =>
      expect(mockDataProvider.getOne).toHaveBeenCalledTimes(1),
    )

    mockState.player = {
      ...createPlayerState(),
      queue: [
        {
          uuid: 'uuid-2',
          trackId: 'track-2',
          isRadio: false,
          song: { title: 'Other Song', artist: 'Artist', album: 'Album' },
        },
      ],
      current: {
        uuid: 'uuid-2',
        trackId: 'track-2',
        isRadio: false,
        song: { title: 'Other Song', artist: 'Artist', album: 'Album' },
      },
      playIndex: 0,
      savedPlayIndex: 0,
    }

    view.rerender(<Player />)

    await waitFor(() =>
      expect(mockDataProvider.getOne).toHaveBeenCalledTimes(1),
    )

    resolveTrack({
      data: {
        id: 'track-1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
      },
    })
  })

  it('forwards follower volume changes using listening volume', async () => {
    mockState.connectSession = {
      ...createConnectSession(),
      isFollower: true,
      hostDeviceId: 'host-device',
    }

    await renderPlayer()

    act(() => {
      playerProps.onAudioVolumeChange(0.1849)
    })

    expect(subsonic.url).toHaveBeenCalledWith('sendConnectCommand', null, {
      deviceId: 'host-device',
      command: 'setVolume',
      volume: 18,
    })
    expect(httpClient).toHaveBeenCalledWith('/rest/sendConnectCommand.view')
  })

  it('broadcasts host volume changes to followers through connect commands', async () => {
    await renderPlayer()
    subsonic.url.mockClear()
    httpClient.mockClear()

    act(() => {
      playerProps.onAudioVolumeChange(0.25)
    })

    expect(subsonic.url).toHaveBeenCalledWith('sendConnectCommand', null, {
      deviceId: 'current-device',
      command: 'setVolume',
      volume: 25,
    })
    expect(httpClient).toHaveBeenCalledWith('/rest/sendConnectCommand.view')
  })

  it('applies incoming setVolume commands as listening volume', async () => {
    mockState.connectSession = {
      ...createConnectSession(),
      isFollower: true,
      hostDeviceId: 'host-device',
    }
    mockState.connectCommand = {
      command: { command: 'setVolume', volume: 25 },
      seq: 1,
    }

    await renderPlayer()

    act(() => {
      playerProps.getAudioInstance(mockAudioInstance)
    })

    await waitFor(() => expect(mockAudioInstance.volume).toBe(0.25))
  })

  it('prefetches the next song without crashing when the current track is missing', async () => {
    mockState.player = {
      ...createPlayerState(),
      queue: [
        {
          uuid: 'uuid-1',
          trackId: 'track-1',
          isRadio: false,
          song: { title: 'Song 1', artist: 'Artist', album: 'Album' },
        },
        {
          uuid: 'uuid-2',
          trackId: 'track-2',
          isRadio: false,
          song: { title: 'Song 2', artist: 'Artist', album: 'Album' },
        },
      ],
      current: undefined,
      savedPlayIndex: 0,
      playIndex: 0,
    }

    await renderPlayer()
    decisionService.prefetchDecisions.mockClear()

    expect(() => {
      act(() => {
        playerProps.onAudioProgress({
          currentTime: 121,
          duration: 200,
          isRadio: false,
        })
      })
    }).not.toThrow()

    expect(decisionService.prefetchDecisions).toHaveBeenCalledWith(['track-2'])
  })

  it('resets follower position to zero and updates the document title on a new followed song', async () => {
    mockState.connectSession = {
      isFollower: true,
      hostDeviceId: 'host-device',
      trackId: 'track-2',
      positionMs: 0,
      state: 'paused',
      title: 'Betrayed',
      artist: 'Lil Xan',
      playMode: 'order',
    }
    mockDataProvider.getOne.mockResolvedValueOnce({
      data: {
        id: 'track-2',
        title: 'Betrayed',
        artist: 'Lil Xan',
        album: 'Album',
        duration: 215,
      },
    })

    mockAudioInstance.currentTime = 91.7

    await renderPlayer()

    act(() => {
      playerProps.getAudioInstance(mockAudioInstance)
    })

    await waitFor(() => expect(mockAudioInstance.currentTime).toBe(0))
    await waitFor(() =>
      expect(document.title).toBe('Betrayed - Lil Xan - Navidrome'),
    )
  })

  it('mutes follower audio so joined sessions can start playing automatically', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    mockState.connectSession = {
      isFollower: true,
      hostDeviceId: 'host-device',
      trackId: 'track-2',
      positionMs: 48437,
      state: 'playing',
      title: 'Lean Wit Me',
      artist: 'Juice WRLD',
      playMode: 'order',
    }
    mockDataProvider.getOne.mockResolvedValueOnce({
      data: {
        id: 'track-2',
        title: 'Lean Wit Me',
        artist: 'Juice WRLD',
        album: 'Album',
        duration: 215,
      },
    })
    mockAudioInstance.paused = true
    mockAudioInstance.play.mockImplementation(() => {
      if (!mockAudioInstance.muted) {
        return Promise.reject(new Error('NotAllowedError'))
      }
      mockAudioInstance.paused = false
      return Promise.resolve()
    })

    try {
      await renderPlayer()

      act(() => {
        playerProps.getAudioInstance(mockAudioInstance)
      })

      await waitFor(() => expect(mockAudioInstance.muted).toBe(true))
      await waitFor(() =>
        expect(mockAudioInstance.currentTime).toBeCloseTo(48.437, 3),
      )
      await waitFor(() => expect(mockAudioInstance.play).toHaveBeenCalled())
      await waitFor(() => expect(mockAudioInstance.paused).toBe(false))
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('does not reset follower progress to zero before seeking to a followed mid-track position', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const assignedTimes = []
    let trackedCurrentTime = 91.7
    const trackedAudioInstance = {
      ...mockAudioInstance,
      get currentTime() {
        return trackedCurrentTime
      },
      set currentTime(value) {
        assignedTimes.push(value)
        trackedCurrentTime = value
      },
    }

    trackedAudioInstance.paused = true
    trackedAudioInstance.readyState = 3
    trackedAudioInstance.play = vi.fn(() => {
      trackedAudioInstance.paused = false
      return Promise.resolve()
    })
    trackedAudioInstance.pause = vi.fn(() => {
      trackedAudioInstance.paused = true
    })

    mockState.connectSession = {
      isFollower: true,
      hostDeviceId: 'host-device',
      trackId: 'track-2',
      positionMs: 48437,
      state: 'playing',
      title: 'Lean Wit Me',
      artist: 'Juice WRLD',
      playMode: 'order',
    }
    mockDataProvider.getOne.mockResolvedValueOnce({
      data: {
        id: 'track-2',
        title: 'Lean Wit Me',
        artist: 'Juice WRLD',
        album: 'Album',
        duration: 215,
      },
    })

    try {
      await renderPlayer()

      act(() => {
        playerProps.getAudioInstance(trackedAudioInstance)
      })

      await waitFor(() => expect(trackedCurrentTime).toBeCloseTo(48.437, 3))
      expect(assignedTimes).not.toContain(0)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
