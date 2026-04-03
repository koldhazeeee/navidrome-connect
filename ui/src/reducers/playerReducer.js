import { v4 as uuidv4 } from 'uuid'
import subsonic from '../subsonic'
import { decisionService } from '../transcode'
import {
  PLAYER_ADD_TRACKS,
  PLAYER_CLEAR_QUEUE,
  PLAYER_CURRENT,
  PLAYER_PLAY_NEXT,
  PLAYER_PLAY_TRACKS,
  PLAYER_SET_TRACK,
  PLAYER_SET_FOLLOWER_TRACK,
  PLAYER_SET_VOLUME,
  PLAYER_SYNC_QUEUE,
  PLAYER_SET_MODE,
  PLAYER_REFRESH_QUEUE,
} from '../actions'
import config from '../config'

const initialState = {
  queue: [],
  current: {},
  clear: false,
  volume: config.defaultUIVolume / 100,
  savedPlayIndex: 0,
}

const pad = (value) => {
  const str = value.toString()
  if (str.length === 1) {
    return `0${str}`
  } else {
    return str
  }
}

const makeMusicSrc = (trackId) =>
  decisionService.getProfile()
    ? () =>
        decisionService
          .resolveStreamUrl(trackId)
          .catch(() => subsonic.streamUrl(trackId))
    : subsonic.streamUrl(trackId)

const mapToAudioLists = (item) => {
  // If item comes from a playlist, trackId is mediaFileId
  const trackId = item.mediaFileId || item.id

  if (item.isRadio) {
    return {
      trackId,
      uuid: uuidv4(),
      name: item.name,
      song: item,
      musicSrc: item.streamUrl,
      cover: item.cover,
      isRadio: true,
    }
  }

  const { lyrics } = item
  let lyricText = ''

  if (lyrics) {
    const structured = JSON.parse(lyrics)
    for (const structuredLyric of structured) {
      if (structuredLyric.synced) {
        for (const line of structuredLyric.line) {
          let time = Math.floor(line.start / 10)
          const ms = time % 100
          time = Math.floor(time / 100)
          const sec = time % 60
          time = Math.floor(time / 60)
          const min = time % 60

          ms.toString()
          lyricText += `[${pad(min)}:${pad(sec)}.${pad(ms)}] ${line.value}\n`
        }
      }
    }
  }

  return {
    trackId,
    uuid: uuidv4(),
    song: item,
    name: item.title,
    lyric: lyricText,
    singer: item.artist,
    duration: item.duration,
    musicSrc: makeMusicSrc(trackId),
    cover: subsonic.getCoverArtUrl(
      {
        id: trackId,
        updatedAt: item.updatedAt,
        album: item.album,
      },
      300,
    ),
  }
}

const reduceClearQueue = () => ({ ...initialState, clear: true })

const reducePlayTracks = (state, { data, id }) => {
  let playIndex = 0
  const queue = Object.keys(data).map((key, idx) => {
    if (key === id) {
      playIndex = idx
    }
    return mapToAudioLists(data[key])
  })
  return {
    ...state,
    queue,
    playIndex,
    clear: true,
  }
}

const getCurrentTrackQueueItem = (state, trackId) => {
  const currentUuid = state.current?.uuid
  if (currentUuid) {
    const currentQueueItem = state.queue.find(
      (item) => item.uuid === currentUuid,
    )
    if (currentQueueItem?.trackId === trackId) {
      return currentQueueItem
    }
  }

  return state.queue.find((item) => item.trackId === trackId)
}

const getReusableTrackUuid = (state, trackId, nextMusicSrc) => {
  const currentTrack = getCurrentTrackQueueItem(state, trackId)
  if (!currentTrack?.uuid) {
    return undefined
  }

  const currentMusicSrc =
    state.current?.uuid === currentTrack.uuid &&
    state.current?.trackId === trackId
      ? (state.current.musicSrc ?? currentTrack.musicSrc)
      : currentTrack.musicSrc

  const isFollowerSilentSrc =
    typeof currentMusicSrc === 'string' && currentMusicSrc.startsWith('blob:')

  if (isFollowerSilentSrc && currentMusicSrc !== nextMusicSrc) {
    return undefined
  }

  return currentTrack.uuid
}

const reduceSetTrack = (state, { data }) => {
  const trackId = data.mediaFileId || data.id
  const nextTrack = mapToAudioLists(data)
  const existingUuid = getReusableTrackUuid(state, trackId, nextTrack.musicSrc)

  if (existingUuid) {
    nextTrack.uuid = existingUuid
  }

  return {
    ...state,
    queue: [nextTrack],
    playIndex: 0,
    clear: true,
  }
}

const reduceSetFollowerTrack = (state, { data, silentSrc }) => {
  const trackId = data.mediaFileId || data.id
  const existingUuid = getReusableTrackUuid(state, trackId, silentSrc)
  return {
    ...state,
    queue: [
      {
        trackId,
        uuid: existingUuid || uuidv4(),
        song: data,
        name: data.title,
        singer: data.artist,
        duration: data.duration,
        musicSrc: silentSrc,
        cover: subsonic.getCoverArtUrl(
          {
            id: trackId,
            updatedAt: data.updatedAt,
            album: data.album,
          },
          300,
        ),
        lyric: '',
      },
    ],
    playIndex: 0,
    clear: true,
  }
}

const reduceAddTracks = (state, { data }) => {
  const queue = state.queue
  Object.keys(data).forEach((id) => {
    queue.push(mapToAudioLists(data[id]))
  })
  return { ...state, queue, clear: false }
}

const reducePlayNext = (state, { data }) => {
  const newTracks = Object.keys(data).map((id) => mapToAudioLists(data[id]))
  const newQueue = []
  const current = state.current || {}
  let foundPos = false
  state.queue.forEach((item) => {
    newQueue.push(item)
    if (item.uuid === current.uuid) {
      foundPos = true
      newQueue.push(...newTracks)
    }
  })
  if (!foundPos) {
    newQueue.push(...newTracks)
  }

  return {
    ...state,
    queue: newQueue,
    clear: true,
  }
}

const reduceSetVolume = (state, { data: { volume } }) => {
  return {
    ...state,
    volume,
  }
}

const reduceSyncQueue = (state, { data: { audioInfo, audioLists } }) => {
  // Only keep clear and playIndex alive when there is an actual pending
  // track switch (playIndex differs from savedPlayIndex). This lets
  // PLAYER_PLAY_TRACKS selections survive the sync, while allowing
  // PLAYER_PLAY_NEXT (which sets playIndex to the current track) to
  // reset immediately and avoid restarting playback.
  const hasPendingSwitch =
    state.playIndex != null && state.playIndex !== state.savedPlayIndex
  return {
    ...state,
    queue: audioLists,
    clear: hasPendingSwitch ? state.clear : false,
    playIndex: hasPendingSwitch ? state.playIndex : undefined,
  }
}

const reduceCurrent = (state, { data }) => {
  const current = data.ended ? {} : data
  const savedPlayIndex = state.queue.findIndex(
    (item) => item.uuid === current.uuid,
  )
  // When a track selection is pending (playIndex is set), keep it alive
  // until the music player confirms it actually switched to the requested
  // track. Without this, a premature onAudioPlay callback for the
  // still-playing old track would overwrite the pending selection.
  const pending = state.playIndex != null && savedPlayIndex !== state.playIndex
  return {
    ...state,
    current,
    playIndex: pending ? state.playIndex : undefined,
    clear: pending ? state.clear : false,
    savedPlayIndex: pending ? state.savedPlayIndex : savedPlayIndex,
    volume: data.volume,
  }
}

const reduceMode = (state, { data: { mode } }) => {
  return {
    ...state,
    mode,
  }
}

export const playerReducer = (previousState = initialState, payload) => {
  const { type } = payload
  switch (type) {
    case PLAYER_CLEAR_QUEUE:
      return reduceClearQueue()
    case PLAYER_PLAY_TRACKS:
      return reducePlayTracks(previousState, payload)
    case PLAYER_SET_TRACK:
      return reduceSetTrack(previousState, payload)
    case PLAYER_SET_FOLLOWER_TRACK:
      return reduceSetFollowerTrack(previousState, payload)
    case PLAYER_ADD_TRACKS:
      return reduceAddTracks(previousState, payload)
    case PLAYER_PLAY_NEXT:
      return reducePlayNext(previousState, payload)
    case PLAYER_SET_VOLUME:
      return reduceSetVolume(previousState, payload)
    case PLAYER_SYNC_QUEUE:
      return reduceSyncQueue(previousState, payload)
    case PLAYER_CURRENT:
      return reduceCurrent(previousState, payload)
    case PLAYER_SET_MODE:
      return reduceMode(previousState, payload)
    case PLAYER_REFRESH_QUEUE: {
      const resolvedUrls = payload.data || {}
      return {
        ...previousState,
        queue: previousState.queue.map((item) => ({
          ...item,
          musicSrc: item.isRadio
            ? item.musicSrc
            : resolvedUrls[item.trackId] || subsonic.streamUrl(item.trackId),
        })),
        clear: true,
        autoPlay: false,
        playIndex:
          previousState.savedPlayIndex >= 0 ? previousState.savedPlayIndex : 0,
      }
    }
    default:
      return previousState
  }
}
