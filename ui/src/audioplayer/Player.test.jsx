import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Player } from './Player'
import subsonic from '../subsonic'

let playerProps
const mockDispatch = vi.fn()
const mockSeekGuard = vi.fn()
const mockAudioInstance = { currentTime: 0, paused: false, volume: 1 }
const mockState = {
  player: {
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
  },
  replayGain: { gainMode: 'off' },
  settings: { notifications: false },
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
  useDataProvider: () => ({ getOne: vi.fn(() => Promise.resolve()) }),
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

vi.mock('../subsonic', () => ({
  default: {
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
  refreshQueue: vi.fn((payload) => ({ type: 'REFRESH_QUEUE', payload })),
  setPlayMode: vi.fn((payload) => ({ type: 'SET_PLAY_MODE', payload })),
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

vi.mock('./useTabSwitchSeekGuard', () => ({
  useTabSwitchSeekGuard: () => mockSeekGuard,
}))

describe('<Player />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playerProps = undefined
    mockAudioInstance.currentTime = 0
    mockAudioInstance.paused = false
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
})
