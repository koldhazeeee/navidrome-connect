import {
  PLAYER_ADD_TRACKS,
  PLAYER_PLAY_NEXT,
  PLAYER_PLAY_TRACKS,
  PLAYER_SET_MODE,
  PLAYER_SET_TRACK,
  PLAYER_SET_VOLUME,
} from '../actions'
import { httpClient } from '../dataProvider'
import subsonic from '../subsonic'

const connectMiddleware = (store) => (next) => (action) => {
  const { connectSession } = store.getState()
  const { isFollower, hostDeviceId } = connectSession || {}
  if (!isFollower || !hostDeviceId) {
    return next(action)
  }

  switch (action.type) {
    case PLAYER_PLAY_TRACKS: {
      const ids = Object.keys(action.data || {})
      if (ids.length === 0) {
        return
      }
      const selectedId = action.id || ids[0]
      const apiUrl = subsonic.url('sendConnectCommand', null, {
        deviceId: hostDeviceId,
        command: 'setQueue',
        id: ids,
        selectedId,
      })
      if (apiUrl) {
        httpClient(apiUrl).catch(() => {})
      }
      return
    }

    case PLAYER_SET_TRACK: {
      const id = action.data?.id
      if (!id) {
        return next(action)
      }
      const apiUrl = subsonic.url('sendConnectCommand', null, {
        deviceId: hostDeviceId,
        command: 'setQueue',
        id: [id],
        selectedId: id,
      })
      if (apiUrl) {
        httpClient(apiUrl).catch(() => {})
      }
      return
    }

    case PLAYER_ADD_TRACKS:
    case PLAYER_PLAY_NEXT:
      return

    case PLAYER_SET_VOLUME: {
      const volume = action.data?.volume
      if (volume != null) {
        const apiUrl = subsonic.url('sendConnectCommand', null, {
          deviceId: hostDeviceId,
          command: 'setVolume',
          volume: Math.round(volume * 100),
        })
        if (apiUrl) {
          httpClient(apiUrl).catch(() => {})
        }
      }
      return
    }

    case PLAYER_SET_MODE: {
      const mode = action.data?.mode
      if (mode) {
        const apiUrl = subsonic.url('sendConnectCommand', null, {
          deviceId: hostDeviceId,
          command: 'setPlayMode',
          playMode: mode,
        })
        if (apiUrl) {
          httpClient(apiUrl).catch(() => {})
        }
      }
      return
    }

    default:
      return next(action)
  }
}

export default connectMiddleware
