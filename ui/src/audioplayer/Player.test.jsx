import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { useMediaQuery } from '@material-ui/core'
import {
  createMuiTheme,
  useAuthState,
  useDataProvider,
  useTranslate,
} from 'react-admin'
import { useDispatch, useSelector } from 'react-redux'
import { Player } from './Player'

let musicPlayerProps

vi.mock('@material-ui/core', async () => {
  const actual = await import('@material-ui/core')
  return { ...actual, useMediaQuery: vi.fn() }
})

vi.mock('react-admin', () => ({
  createMuiTheme: vi.fn(() => ({})),
  useAuthState: vi.fn(),
  useDataProvider: vi.fn(),
  useTranslate: vi.fn(),
}))

vi.mock('react-redux', () => ({ useDispatch: vi.fn(), useSelector: vi.fn() }))
vi.mock('react-ga', () => ({ default: { event: vi.fn() } }))
vi.mock('react-hotkeys', () => ({ GlobalHotKeys: () => null }))
vi.mock('navidrome-music-player', () => ({
  default: (props) => (
    (musicPlayerProps = props),
    (<div data-testid="player" />)
  ),
}))
vi.mock('../themes/useCurrentTheme', () => ({
  default: vi.fn(() => ({ player: {} })),
}))
vi.mock('./styles', () => ({ default: vi.fn(() => ({ player: 'player' })) }))
vi.mock('./AudioTitle', () => ({ default: () => null }))
vi.mock('./PlayerToolbar', () => ({ default: () => null }))
vi.mock('./locale', () => ({ default: vi.fn(() => ({})) }))
vi.mock('./keyHandlers', () => ({ default: vi.fn(() => ({})) }))
vi.mock('../hotkeys', () => ({ keyMap: {} }))
vi.mock('../utils', () => ({ sendNotification: vi.fn() }))
vi.mock('../subsonic', () => ({
  default: { nowPlaying: vi.fn(), scrobble: vi.fn() },
}))
vi.mock('../utils/calculateReplayGain', () => ({
  calculateGain: vi.fn(() => 1),
}))
vi.mock('../transcode', () => ({
  detectBrowserProfile: vi.fn(() => 'test'),
  decisionService: { setProfile: vi.fn(), prefetchDecisions: vi.fn() },
}))
vi.mock('../config', () => ({
  default: { enableCoverAnimation: false, enableReplayGain: false },
}))
vi.mock('../actions', () => ({
  clearQueue: vi.fn(() => ({ type: 'CLEAR_QUEUE' })),
  currentPlaying: vi.fn((data) => ({ type: 'CURRENT_PLAYING', data })),
  refreshQueue: vi.fn(() => ({ type: 'REFRESH_QUEUE' })),
  setPlayMode: vi.fn((mode) => ({ type: 'SET_PLAY_MODE', mode })),
  setTranscodingProfile: vi.fn((profile) => ({
    type: 'SET_TRANSCODING_PROFILE',
    profile,
  })),
  setVolume: vi.fn((volume) => ({ type: 'SET_VOLUME', volume })),
  syncQueue: vi.fn((audioInfo, audioLists) => ({
    type: 'SYNC_QUEUE',
    data: { audioInfo, audioLists },
  })),
}))

describe('<Player />', () => {
  const dispatch = vi.fn()
  const state = {
    player: {
      queue: [],
      current: {},
      mode: 'order',
      volume: 1,
      savedPlayIndex: 0,
    },
    replayGain: { gainMode: 'off' },
    settings: { notifications: false },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    musicPlayerProps = undefined
    useMediaQuery.mockReturnValue(true)
    useDispatch.mockReturnValue(dispatch)
    useSelector.mockImplementation((selector) => selector(state))
    useAuthState.mockReturnValue({ authenticated: true })
    useDataProvider.mockReturnValue({ getOne: vi.fn() })
    useTranslate.mockReturnValue((key) => key)
    createMuiTheme.mockReturnValue({})
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('blurs the active seek handle on seek and window blur', () => {
    render(<Player />)
    const handle = document.body.appendChild(document.createElement('button'))
    handle.className = 'rc-slider-handle'
    handle.blur = vi.fn()
    handle.focus()

    musicPlayerProps.onAudioSeeked()
    handle.focus()
    window.dispatchEvent(new Event('blur'))

    expect(handle.blur).toHaveBeenCalledTimes(2)
  })
})
