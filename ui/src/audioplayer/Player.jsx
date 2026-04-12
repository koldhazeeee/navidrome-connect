import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMediaQuery } from '@material-ui/core'
import { ThemeProvider } from '@material-ui/core/styles'
import {
  createMuiTheme,
  useAuthState,
  useDataProvider,
  useTranslate,
} from 'react-admin'
import ReactGA from 'react-ga'
import { GlobalHotKeys } from 'react-hotkeys'
import ReactJkMusicPlayer from 'navidrome-music-player'
import 'navidrome-music-player/assets/index.css'
import useCurrentTheme from '../themes/useCurrentTheme'
import config from '../config'
import useStyle from './styles'
import AudioTitle from './AudioTitle'
import {
  clearQueue,
  currentPlaying,
  playTracks,
  refreshQueue,
  setFollowerTrack,
  setPlayMode,
  setTrack,
  setTranscodingProfile,
  setVolume,
  syncQueue,
} from '../actions'
import PlayerToolbar from './PlayerToolbar'
import { clientUniqueId, httpClient } from '../dataProvider'
import { sendNotification } from '../utils'
import subsonic from '../subsonic'
import locale from './locale'
import { keyMap } from '../hotkeys'
import keyHandlers from './keyHandlers'
import { calculateGain } from '../utils/calculateReplayGain'
import { createSilentBlobUrl } from '../utils/silentAudio'
import { detectBrowserProfile, decisionService } from '../transcode'
import { useTabSwitchSeekGuard } from './useTabSwitchSeekGuard'
import connectDebug from '../utils/connectDebug'

const connectCommandSeekState = (audio) =>
  audio?.paused ? 'paused' : 'playing'

const Player = () => {
  const theme = useCurrentTheme()
  const translate = useTranslate()
  const playerTheme = theme.player?.theme || 'dark'
  const dataProvider = useDataProvider()
  const playerState = useSelector((state) => state.player)
  const connectCommand = useSelector((state) => state.connectCommand)
  const connectSession = useSelector((state) => state.connectSession)
  const dispatch = useDispatch()
  const [startTime, setStartTime] = useState(null)
  const [scrobbled, setScrobbled] = useState(false)
  const [preloaded, setPreload] = useState(false)
  const [audioInstance, setAudioInstance] = useState(null)
  const audioInstanceRef = useRef(audioInstance)
  audioInstanceRef.current = audioInstance
  const isDesktop = useMediaQuery('(min-width:810px)')
  const isMobilePlayer =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )

  const { authenticated } = useAuthState()

  // Keep a ref to playerState so the mount effect can read the latest value
  // without re-triggering on every queue/position change
  const playerStateRef = useRef(playerState)
  playerStateRef.current = playerState
  const silentBlobRef = useRef(null)
  const followerTrackRef = useRef(null)
  const followerSyncRef = useRef({
    trackId: null,
    positionMs: 0,
    state: null,
    receivedAt: 0,
  })
  const suppressConnectForwardRef = useRef(false)
  const suppressConnectForwardUntilRef = useRef(0)

  // Detect browser codec profile and eagerly resolve transcode URLs for the
  // persisted queue once on mount (e.g. after a browser refresh)
  useEffect(() => {
    const profile = detectBrowserProfile()
    decisionService.setProfile(profile)
    dispatch(setTranscodingProfile(profile))

    const state = playerStateRef.current
    const currentIdx = state.savedPlayIndex || 0
    const trackIds = state.queue
      .slice(currentIdx, currentIdx + 4)
      .filter((item) => !item.isRadio && item.trackId)
      .map((item) => item.trackId)

    if (trackIds.length === 0) {
      dispatch(refreshQueue())
      return
    }

    Promise.allSettled(
      trackIds.map((id) =>
        decisionService.resolveStreamUrl(id).then((url) => [id, url]),
      ),
    ).then((results) => {
      const resolvedUrls = {}
      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          resolvedUrls[r.value[0]] = r.value[1]
        }
      })
      dispatch(refreshQueue(resolvedUrls))
    })
  }, [dispatch])

  // Pre-fetch transcode decisions for next 2-3 songs when queue or position changes
  useEffect(() => {
    if (!playerState.queue.length) return

    const currentIdx = playerState.savedPlayIndex || 0
    const nextSongIds = playerState.queue
      .slice(currentIdx + 1, currentIdx + 4)
      .filter((item) => !item.isRadio)
      .map((item) => item.trackId)

    if (nextSongIds.length > 0) {
      decisionService.prefetchDecisions(nextSongIds)
    }
  }, [playerState.queue, playerState.savedPlayIndex])

  const visible = authenticated && playerState.queue.length > 0
  const isRadio = playerState.current?.isRadio || false
  const currentTrack = playerState.current
  const classes = useStyle({
    isRadio,
    visible,
    enableCoverAnimation: config.enableCoverAnimation,
  })
  const showNotifications = useSelector(
    (state) => state.settings.notifications || false,
  )
  const gainInfo = useSelector((state) => state.replayGain)
  const [context, setContext] = useState(null)
  const [gainNode, setGainNode] = useState(null)
  const restoreSeekedPosition = useTabSwitchSeekGuard(audioInstance)

  useEffect(
    () => () => {
      if (silentBlobRef.current) {
        URL.revokeObjectURL(silentBlobRef.current)
        silentBlobRef.current = null
      }
    },
    [],
  )

  const withSuppressedConnectForwarding = useCallback((fn) => {
    suppressConnectForwardRef.current = true
    try {
      fn()
    } finally {
      window.setTimeout(() => {
        suppressConnectForwardRef.current = false
      }, 250)
    }
  }, [])

  const suppressConnectForwardingFor = useCallback((durationMs) => {
    suppressConnectForwardUntilRef.current = Math.max(
      suppressConnectForwardUntilRef.current,
      Date.now() + durationMs,
    )
  }, [])

  const isConnectForwardingSuppressed = useCallback(
    () =>
      suppressConnectForwardRef.current ||
      Date.now() < suppressConnectForwardUntilRef.current,
    [],
  )

  const getCurrentAudioElement = useCallback(
    () => document.querySelector('audio') || audioInstanceRef.current,
    [],
  )

  const primeAudioPosition = useCallback(
    (targetSeconds) => {
      const desiredTime = Math.max(targetSeconds ?? 0, 0)

      window.requestAnimationFrame(() => {
        const audio = getCurrentAudioElement()
        if (!audio) {
          return
        }
        try {
          audio.currentTime = desiredTime
        } catch {
          // Ignore eager seeks before the replacement source is seekable.
        }
      })
    },
    [getCurrentAudioElement],
  )

  const waitForAudioReady = useCallback(
    (callback) => {
      let rafId = 0
      let pollId = 0
      let timeoutId = 0
      let observedAudio = null

      const readyEvents = [
        'canplay',
        'canplaythrough',
        'loadeddata',
        'loadedmetadata',
      ]

      const removeListeners = () => {
        if (
          !observedAudio ||
          typeof observedAudio.removeEventListener !== 'function'
        ) {
          return
        }
        readyEvents.forEach((eventName) => {
          observedAudio.removeEventListener(eventName, handleReady)
        })
      }

      const cleanup = () => {
        window.cancelAnimationFrame(rafId)
        window.clearTimeout(pollId)
        window.clearTimeout(timeoutId)
        removeListeners()
      }

      const finish = (audio) => {
        cleanup()
        callback(audio)
      }

      function handleReady() {
        const audio = getCurrentAudioElement()
        if (audio) {
          finish(audio)
        }
      }

      const scheduleWatch = () => {
        if (document.hidden) {
          pollId = window.setTimeout(watch, 100)
          return
        }
        rafId = window.requestAnimationFrame(watch)
      }

      const watch = () => {
        const audio = getCurrentAudioElement()
        if (audio !== observedAudio) {
          removeListeners()
          observedAudio = audio
          if (
            observedAudio &&
            typeof observedAudio.addEventListener === 'function'
          ) {
            readyEvents.forEach((eventName) => {
              observedAudio.addEventListener(eventName, handleReady)
            })
          }
        }

        if (audio && audio.readyState >= 2) {
          finish(audio)
          return
        }

        scheduleWatch()
      }

      watch()
      timeoutId = window.setTimeout(cleanup, 10000)
    },
    [getCurrentAudioElement],
  )

  const sendCommandToHost = useCallback(
    (command, params = {}) => {
      if (!connectSession?.hostDeviceId) {
        return
      }
      const apiUrl = subsonic.url('sendConnectCommand', null, {
        deviceId: connectSession.hostDeviceId,
        command,
        ...params,
      })
      if (apiUrl) {
        httpClient(apiUrl).catch(() => {})
      }
    },
    [connectSession?.hostDeviceId],
  )

  const sendCommandToFollowers = useCallback((command, params = {}) => {
    if (!config.enableConnect || !clientUniqueId) {
      return
    }
    const apiUrl = subsonic.url('sendConnectCommand', null, {
      deviceId: clientUniqueId,
      command,
      ...params,
    })
    if (apiUrl) {
      httpClient(apiUrl).catch(() => {})
    }
  }, [])

  const reportPlayback = useCallback((trackId, currentTime, state) => {
    if (!trackId) {
      return
    }
    const positionMs = Math.max(Math.floor((currentTime ?? 0) * 1000), 0)
    connectDebug('reportPlayback send', {
      trackId,
      state,
      positionMs,
    })
    subsonic.reportPlayback(trackId, positionMs, state, 1.0, true)
  }, [])

  const setSongDocumentTitle = useCallback((song) => {
    if (song?.title && song?.artist) {
      document.title = `${song.title} - ${song.artist} - Navidrome`
      return
    }
    if (song?.title) {
      document.title = `${song.title} - Navidrome`
      return
    }
    document.title = 'Navidrome'
  }, [])

  useEffect(() => {
    if (
      context === null &&
      audioInstance &&
      config.enableReplayGain &&
      'AudioContext' in window &&
      (gainInfo.gainMode === 'album' || gainInfo.gainMode === 'track')
    ) {
      const ctx = new AudioContext()
      // we need this to support radios in firefox
      audioInstance.crossOrigin = 'anonymous'
      const source = ctx.createMediaElementSource(audioInstance)
      const gain = ctx.createGain()

      source.connect(gain)
      gain.connect(ctx.destination)

      setContext(ctx)
      setGainNode(gain)
    }
  }, [audioInstance, context, gainInfo.gainMode])

  useEffect(() => {
    if (!audioInstance) {
      return
    }
    withSuppressedConnectForwarding(() => {
      audioInstance.muted = connectSession?.isFollower === true
    })
  }, [
    audioInstance,
    connectSession?.isFollower,
    withSuppressedConnectForwarding,
  ])

  useEffect(() => {
    if (!connectSession?.isFollower) {
      followerSyncRef.current = {
        trackId: null,
        positionMs: 0,
        state: null,
        receivedAt: 0,
      }
      return
    }

    followerSyncRef.current = {
      trackId: connectSession.trackId,
      positionMs: Math.max(connectSession.positionMs ?? 0, 0),
      state: connectSession.state,
      receivedAt: Date.now(),
    }
  }, [
    connectSession?.isFollower,
    connectSession?.positionMs,
    connectSession?.state,
    connectSession?.trackId,
  ])

  const getEstimatedFollowerPositionMs = useCallback(() => {
    const sync = followerSyncRef.current
    let positionMs = Math.max(sync.positionMs ?? 0, 0)

    if (sync.state === 'playing' && sync.receivedAt) {
      positionMs += Math.max(Date.now() - sync.receivedAt, 0)
    }

    if (connectSession?.durationMs) {
      positionMs = Math.min(positionMs, connectSession.durationMs)
    }

    return positionMs
  }, [connectSession?.durationMs])

  const syncFollowerPlaybackPosition = useCallback(
    (audio, { force = false } = {}) => {
      if (!audio || !connectSession?.isFollower) {
        return null
      }

      const desiredTime = getEstimatedFollowerPositionMs() / 1000
      const driftSeconds = Math.abs((audio.currentTime ?? 0) - desiredTime)
      if (force || desiredTime === 0 || driftSeconds > 0.75) {
        connectDebug('follower sync apply estimated time', {
          trackId: connectSession.trackId,
          applyingSeconds: desiredTime,
          previousSeconds: audio.currentTime,
          driftSeconds,
          force,
        })
        audio.currentTime = desiredTime
      }

      return desiredTime
    },
    [
      connectSession?.isFollower,
      connectSession?.trackId,
      getEstimatedFollowerPositionMs,
    ],
  )

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden || !audioInstance || !connectSession?.isFollower) {
        return
      }

      const desiredTime = syncFollowerPlaybackPosition(audioInstance, {
        force: true,
      })

      connectDebug('resuming follower after tab becomes visible', {
        trackId: connectSession.trackId,
        positionMs: desiredTime != null ? Math.round(desiredTime * 1000) : 0,
        wasPaused: audioInstance.paused,
      })

      if (connectSession.state !== 'playing' || !audioInstance.paused) {
        return
      }

      withSuppressedConnectForwarding(() => {
        audioInstance.muted = true
        audioInstance.play().catch(() => {})
      })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [
    audioInstance,
    connectSession?.isFollower,
    connectSession?.state,
    connectSession?.trackId,
    syncFollowerPlaybackPosition,
    withSuppressedConnectForwarding,
  ])

  useEffect(() => {
    if (gainNode) {
      const current = playerState.current || {}
      const song = current.song || {}

      const numericGain = calculateGain(gainInfo, song)
      gainNode.gain.setValueAtTime(numericGain, context.currentTime)
    }
  }, [audioInstance, context, gainNode, playerState, gainInfo])

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Check there's a current track and is actually playing/not paused
      if (playerState.current?.uuid && audioInstance && !audioInstance.paused) {
        e.preventDefault()
        e.returnValue = '' // Chrome requires returnValue to be set
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [playerState, audioInstance])

  useEffect(() => {
    const command = connectCommand?.command
    if (!command) {
      return
    }

    const loadTrack = (trackId, onReady) => {
      dataProvider
        .getOne('song', { id: trackId })
        .then(({ data }) => {
          dispatch(setTrack(data))
          if (command.positionMs != null) {
            primeAudioPosition(command.positionMs / 1000)
          }
          waitForAudioReady((audio) => onReady(audio, data))
        })
        .catch(() => {})
    }

    if (
      (command.command === 'becomeHost' ||
        command.command === 'startFromState') &&
      command.trackId
    ) {
      suppressConnectForwardingFor(2000)
      if (silentBlobRef.current) {
        URL.revokeObjectURL(silentBlobRef.current)
        silentBlobRef.current = null
      }
      followerTrackRef.current = null
      loadTrack(command.trackId, (audio) => {
        withSuppressedConnectForwarding(() => {
          audio.muted = false
          if (command.positionMs != null) {
            audio.currentTime = command.positionMs / 1000
          }
          if (command.startPlaying === false) {
            audio.pause()
          } else {
            audio.play().catch(() => {})
          }
        })
      })
      return
    }

    if (command.command === 'setQueue' && command.trackIds?.length) {
      Promise.all(
        command.trackIds.map((id) =>
          dataProvider.getOne('song', { id }).then(({ data }) => data),
        ),
      )
        .then((songs) => {
          const data = {}
          const ids = []
          songs.forEach((song) => {
            data[song.id] = song
            ids.push(song.id)
          })
          dispatch(playTracks(data, ids, command.selectedId || ids[0]))
        })
        .catch(() => {})
      return
    }

    if (command.command === 'exitFollower') {
      followerTrackRef.current = null
      if (silentBlobRef.current) {
        URL.revokeObjectURL(silentBlobRef.current)
        silentBlobRef.current = null
      }
      return
    }

    if (!audioInstance) {
      return
    }

    switch (command.command) {
      case 'pause':
        if (!audioInstance.paused) {
          audioInstance.pause()
        }
        break
      case 'play':
      case 'resume':
        if (audioInstance.paused) {
          audioInstance.play().catch(() => {})
        }
        break
      case 'stop':
        audioInstance.pause()
        audioInstance.currentTime = 0
        break
      case 'seek':
        if (command.positionMs != null) {
          const positionSeconds = command.positionMs / 1000
          audioInstance.currentTime = positionSeconds
          if (!connectSession?.isFollower) {
            const trackId =
              command.trackId || playerStateRef.current?.current?.trackId
            if (trackId) {
              reportPlayback(
                trackId,
                positionSeconds,
                connectCommandSeekState(audioInstance),
              )
            }
          }
        }
        break
      case 'setVolume':
        if (command.volume != null) {
          withSuppressedConnectForwarding(() => {
            audioInstance.volume = Math.max(
              0,
              Math.min(1, command.volume / 100),
            )
          })
        }
        break
      case 'setPlayMode':
        if (command.playMode) {
          dispatch(setPlayMode(command.playMode))
        }
        break
      case 'next':
        audioInstance.playNext?.()
        break
      case 'prev':
        audioInstance.playPrev?.()
        break
      default:
        break
    }
  }, [
    audioInstance,
    connectCommand?.command,
    connectCommand?.seq,
    connectSession?.isFollower,
    dataProvider,
    dispatch,
    primeAudioPosition,
    reportPlayback,
    suppressConnectForwardingFor,
    waitForAudioReady,
    withSuppressedConnectForwarding,
  ])

  useEffect(() => {
    if (!connectSession?.isFollower) {
      followerTrackRef.current = null
      return
    }

    if (
      connectSession.trackId &&
      connectSession.trackId !== followerTrackRef.current
    ) {
      suppressConnectForwardingFor(2000)
      dataProvider
        .getOne('song', { id: connectSession.trackId })
        .then(({ data }) => {
          if (silentBlobRef.current) {
            URL.revokeObjectURL(silentBlobRef.current)
          }
          connectDebug('follower track change received', {
            trackId: connectSession.trackId,
            title: data.title,
            artist: data.artist,
            receivedPositionMs: connectSession.positionMs ?? 0,
            receivedState: connectSession.state,
            previousCurrentTime: audioInstance?.currentTime ?? null,
          })
          followerTrackRef.current = connectSession.trackId
          silentBlobRef.current = createSilentBlobUrl(data.duration || 300)
          dispatch(setFollowerTrack(data, silentBlobRef.current))
          setSongDocumentTitle(data)
          primeAudioPosition(Math.max(connectSession.positionMs ?? 0, 0) / 1000)
          waitForAudioReady((audio) => {
            withSuppressedConnectForwarding(() => {
              const desiredTime = syncFollowerPlaybackPosition(audio, {
                force: true,
              })
              connectDebug('follower initial seek apply', {
                trackId: connectSession.trackId,
                receivedPositionMs: connectSession.positionMs ?? 0,
                appliedSeconds: desiredTime,
                audioReadyState: audio.readyState,
              })
              suppressConnectForwardingFor(2000)
              audio.muted = true
              if (connectSession.state === 'paused') {
                audio.pause()
              } else {
                audio.play().catch(() => {})
              }
            })
          })
        })
        .catch(() => {})
      return
    }

    if (!audioInstance) {
      return
    }

    if (connectSession.positionMs != null) {
      const desiredTime = getEstimatedFollowerPositionMs() / 1000
      const driftSeconds = Math.abs(audioInstance.currentTime - desiredTime)
      connectDebug('follower sync received', {
        trackId: connectSession.trackId,
        receivedPositionMs: connectSession.positionMs,
        desiredSeconds: desiredTime,
        currentSeconds: audioInstance.currentTime,
        driftSeconds,
        forceReset: desiredTime === 0,
      })
      if (desiredTime === 0 || driftSeconds > 3) {
        withSuppressedConnectForwarding(() => {
          syncFollowerPlaybackPosition(audioInstance, { force: true })
        })
      }
    }

    if (connectSession.state === 'paused' && !audioInstance.paused) {
      withSuppressedConnectForwarding(() => {
        audioInstance.pause()
      })
    } else if (connectSession.state === 'playing' && audioInstance.paused) {
      withSuppressedConnectForwarding(() => {
        audioInstance.muted = true
        audioInstance.play().catch(() => {})
      })
    }

    if (
      connectSession.playMode &&
      connectSession.playMode !== playerStateRef.current.mode
    ) {
      dispatch(setPlayMode(connectSession.playMode))
    }
  }, [
    audioInstance,
    connectSession?.isFollower,
    connectSession?.playMode,
    connectSession?.positionMs,
    connectSession?.state,
    connectSession?.trackId,
    dataProvider,
    dispatch,
    getEstimatedFollowerPositionMs,
    primeAudioPosition,
    setSongDocumentTitle,
    suppressConnectForwardingFor,
    syncFollowerPlaybackPosition,
    waitForAudioReady,
    withSuppressedConnectForwarding,
  ])

  useEffect(() => {
    if (!connectSession?.isFollower) {
      return undefined
    }

    const handleClick = (event) => {
      const button = event.target.closest(
        '.group.next-audio, .group.prev-audio',
      )
      if (!button) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      sendCommandToHost(
        button.classList.contains('next-audio') ? 'next' : 'prev',
      )
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [connectSession?.isFollower, sendCommandToHost])

  const defaultOptions = useMemo(
    () => ({
      theme: playerTheme,
      bounds: 'body',
      playMode: playerState.mode,
      mode: 'full',
      loadAudioErrorPlayNext: false,
      autoPlayInitLoadPlayList: true,
      clearPriorAudioLists: false,
      showDestroy: true,
      showDownload: false,
      showLyric: true,
      showReload: false,
      toggleMode: !isDesktop,
      glassBg: false,
      showThemeSwitch: false,
      showMediaSession: true,
      restartCurrentOnPrev: true,
      quietUpdate: true,
      defaultPosition: {
        top: 300,
        left: 120,
      },
      volumeFade: { fadeIn: 200, fadeOut: 200 },
      renderAudioTitle: (audioInfo, isMobile) => (
        <AudioTitle
          audioInfo={audioInfo}
          gainInfo={gainInfo}
          isMobile={isMobile}
        />
      ),
      locale: locale(translate),
      sortableOptions: { delay: 200, delayOnTouchOnly: true },
    }),
    [gainInfo, isDesktop, playerTheme, translate, playerState.mode],
  )

  const options = useMemo(() => {
    const current = playerState.current || {}
    return {
      ...defaultOptions,
      audioLists: playerState.queue.map((item) => item),
      playIndex: playerState.playIndex,
      autoPlay:
        playerState.autoPlay !== false &&
        (playerState.clear || playerState.playIndex === 0),
      clearPriorAudioLists: playerState.clear,
      extendsContent: (
        <PlayerToolbar id={current.trackId} isRadio={current.isRadio} />
      ),
      defaultVolume: isMobilePlayer ? 1 : playerState.volume,
      showMediaSession: !current.isRadio,
    }
  }, [playerState, defaultOptions, isMobilePlayer])

  const onAudioListsChange = useCallback(
    (_, audioLists, audioInfo) => dispatch(syncQueue(audioInfo, audioLists)),
    [dispatch],
  )

  const nextSong = useCallback(() => {
    const currentUuid = playerState.current?.uuid
    if (currentUuid) {
      const currentIdx = playerState.queue.findIndex(
        (item) => item.uuid === currentUuid,
      )
      if (currentIdx >= 0) {
        return playerState.queue[currentIdx + 1] ?? null
      }
    }

    const fallbackIndex = [
      playerState.savedPlayIndex,
      playerState.playIndex,
    ].find(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < playerState.queue.length,
    )

    return fallbackIndex != null
      ? (playerState.queue[fallbackIndex + 1] ?? null)
      : null
  }, [playerState])

  const onAudioProgress = useCallback(
    (info) => {
      if (info.ended) {
        document.title = 'Navidrome'
      }

      const progress = (info.currentTime / info.duration) * 100
      if (isNaN(info.duration) || (progress < 50 && info.currentTime < 240)) {
        return
      }

      if (info.isRadio) {
        return
      }

      if (!preloaded) {
        const next = nextSong()
        if (next != null && !next.isRadio) {
          // Trigger decision pre-fetch (this also warms the cache)
          decisionService.prefetchDecisions([next.trackId])
        }
        setPreload(true)
        return
      }

      if (!scrobbled) {
        info.trackId && subsonic.scrobble(info.trackId, startTime)
        setScrobbled(true)
      }
    },
    [startTime, scrobbled, nextSong, preloaded],
  )

  const onAudioVolumeChange = useCallback(
    // sqrt to compensate for the logarithmic volume
    (volume) => {
      const volumeBarValue = Math.sqrt(volume)
      if (connectSession?.isFollower) {
        if (!suppressConnectForwardRef.current) {
          sendCommandToHost('setVolume', {
            volume: Math.round(volume * 100),
          })
        }
        return
      }
      if (!suppressConnectForwardRef.current) {
        sendCommandToFollowers('setVolume', {
          volume: Math.round(volume * 100),
        })
      }
      dispatch(setVolume(volumeBarValue))
    },
    [
      connectSession?.isFollower,
      dispatch,
      sendCommandToFollowers,
      sendCommandToHost,
    ],
  )

  const onAudioPlay = useCallback(
    (info) => {
      // Do this to start the context; on chrome-based browsers, the context
      // will start paused since it is created prior to user interaction
      if (context && context.state !== 'running') {
        context.resume()
      }

      dispatch(currentPlaying(info))
      if (info.duration && info.song) {
        setSongDocumentTitle(info.song)
      }
      if (connectSession?.isFollower) {
        if (!suppressConnectForwardRef.current) {
          sendCommandToHost('play')
        }
        return
      }
      if (startTime === null) {
        setStartTime(Date.now())
      }
      if (info.duration) {
        const song = info.song
        if (!info.isRadio) {
          reportPlayback(info.trackId, info.currentTime, 'playing')
        }
        setPreload(false)
        if (config.gaTrackingId) {
          ReactGA.event({
            category: 'Player',
            action: 'Play song',
            label: `${song.title} - ${song.artist}`,
          })
        }
        if (showNotifications) {
          sendNotification(
            song.title,
            `${song.artist} - ${song.album}`,
            info.cover,
          )
        }
      }
    },
    [
      connectSession?.isFollower,
      context,
      dispatch,
      reportPlayback,
      sendCommandToHost,
      setSongDocumentTitle,
      showNotifications,
      startTime,
    ],
  )

  const onAudioSeeked = useCallback(() => {
    restoreSeekedPosition()
    if (connectSession?.isFollower) {
      if (!suppressConnectForwardRef.current && audioInstance) {
        sendCommandToHost('seek', {
          positionMs: Math.max(Math.floor(audioInstance.currentTime * 1000), 0),
        })
      }
      return
    }
    if (!currentTrack?.isRadio && currentTrack?.trackId && audioInstance) {
      reportPlayback(
        currentTrack.trackId,
        audioInstance.currentTime,
        audioInstance.paused ? 'paused' : 'playing',
      )
    }
  }, [
    audioInstance,
    connectSession?.isFollower,
    currentTrack,
    reportPlayback,
    restoreSeekedPosition,
    sendCommandToHost,
  ])

  const onAudioPlayTrackChange = useCallback(() => {
    if (connectSession?.isFollower) {
      if (scrobbled) {
        setScrobbled(false)
      }
      if (startTime !== null) {
        setStartTime(null)
      }
      return
    }
    if (
      startTime !== null &&
      currentTrack?.trackId &&
      audioInstance &&
      !currentTrack.isRadio
    ) {
      reportPlayback(currentTrack.trackId, audioInstance.currentTime, 'stopped')
    }
    if (scrobbled) {
      setScrobbled(false)
    }
    if (startTime !== null) {
      setStartTime(null)
    }
  }, [
    audioInstance,
    connectSession?.isFollower,
    currentTrack,
    reportPlayback,
    scrobbled,
    startTime,
  ])

  const onAudioPause = useCallback(
    (info) => {
      dispatch(currentPlaying(info))
      if (connectSession?.isFollower) {
        if (document.hidden) {
          connectDebug('ignored follower pause while hidden', {
            trackId: info.trackId,
            currentTime: info.currentTime,
          })
          return
        }
        if (!isConnectForwardingSuppressed()) {
          sendCommandToHost('pause')
        }
        return
      }
      if (!info.isRadio) {
        reportPlayback(info.trackId, info.currentTime, 'paused')
      }
    },
    [
      connectSession?.isFollower,
      dispatch,
      isConnectForwardingSuppressed,
      reportPlayback,
      sendCommandToHost,
    ],
  )

  const onAudioEnded = useCallback(
    (currentPlayId, audioLists, info) => {
      setScrobbled(false)
      setStartTime(null)
      if (connectSession?.isFollower) {
        if (!isConnectForwardingSuppressed()) {
          sendCommandToHost('stop')
        }
        dispatch(currentPlaying(info))
        return
      }
      if (!info.isRadio) {
        reportPlayback(info.trackId, info.currentTime, 'stopped')
      }
      dispatch(currentPlaying(info))
      dataProvider
        .getOne('keepalive', { id: info.trackId })
        // eslint-disable-next-line no-console
        .catch((e) => console.log('Keepalive error:', e))
    },
    [
      connectSession?.isFollower,
      dataProvider,
      dispatch,
      isConnectForwardingSuppressed,
      reportPlayback,
      sendCommandToHost,
    ],
  )

  const onCoverClick = useCallback((mode, audioLists, audioInfo) => {
    if (mode === 'full' && audioInfo?.song?.albumId) {
      window.location.href = `#/album/${audioInfo.song.albumId}/show`
    }
  }, [])

  const onAudioError = useCallback(
    (error, currentPlayId, audioLists, audioInfo) => {
      // Invalidate all cached decisions — token may be stale
      decisionService.invalidateAll()

      // Pre-fetch decisions for upcoming songs with fresh tokens
      const currentIdx = playerState.queue.findIndex(
        (item) => item.uuid === currentPlayId,
      )
      if (currentIdx >= 0) {
        const nextSongIds = playerState.queue
          .slice(currentIdx + 1, currentIdx + 4)
          .filter((item) => !item.isRadio)
          .map((item) => item.trackId)
        if (nextSongIds.length > 0) {
          decisionService.prefetchDecisions(nextSongIds)
        }
      }
    },
    [playerState.queue],
  )

  const onBeforeDestroy = useCallback(() => {
    return new Promise((resolve, reject) => {
      dispatch(clearQueue())
      reject()
    })
  }, [dispatch])

  if (!visible) {
    document.title = 'Navidrome'
  }

  const handlers = useMemo(
    () => keyHandlers(audioInstance, playerState),
    [audioInstance, playerState],
  )

  useEffect(() => {
    if (isMobilePlayer && audioInstance) {
      audioInstance.volume = 1
    }
  }, [isMobilePlayer, audioInstance])

  return (
    <ThemeProvider theme={createMuiTheme(theme)}>
      <ReactJkMusicPlayer
        {...options}
        className={classes.player}
        onAudioListsChange={onAudioListsChange}
        onAudioVolumeChange={onAudioVolumeChange}
        onAudioProgress={onAudioProgress}
        onAudioPlay={onAudioPlay}
        onAudioPlayTrackChange={onAudioPlayTrackChange}
        onAudioSeeked={onAudioSeeked}
        onAudioPause={onAudioPause}
        onPlayModeChange={(mode) => {
          if (
            connectSession?.isFollower &&
            !suppressConnectForwardRef.current
          ) {
            sendCommandToHost('setPlayMode', { playMode: mode })
            return
          }
          dispatch(setPlayMode(mode))
        }}
        onAudioEnded={onAudioEnded}
        onCoverClick={onCoverClick}
        onAudioError={onAudioError}
        onBeforeDestroy={onBeforeDestroy}
        getAudioInstance={setAudioInstance}
      />
      <GlobalHotKeys handlers={handlers} keyMap={keyMap} allowChanges />
    </ThemeProvider>
  )
}

export { Player }
