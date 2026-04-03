import { EVENT_CONNECT_COMMAND } from '../actions/serverEvents'

const initialState = {
  isFollower: false,
  hostDeviceId: null,
  trackId: null,
  positionMs: 0,
  state: null,
  title: null,
  artist: null,
  durationMs: 0,
  playMode: null,
}

export const connectSessionReducer = (
  previousState = initialState,
  payload,
) => {
  const { type, data } = payload

  if (type === EVENT_CONNECT_COMMAND && data) {
    switch (data.command) {
      case 'becomeFollower':
        if (!data.hostDeviceId) {
          return previousState
        }
        return {
          ...previousState,
          isFollower: true,
          hostDeviceId: data.hostDeviceId,
          trackId: data.trackId || previousState.trackId,
          positionMs: data.positionMs || 0,
          state: data.startPlaying ? 'playing' : 'paused',
        }
      case 'becomeHost':
      case 'exitFollower':
        return { ...initialState }
      default:
        return previousState
    }
  }

  if (
    type === 'connectStateChanged' &&
    data &&
    previousState.isFollower &&
    previousState.hostDeviceId
  ) {
    return {
      ...previousState,
      trackId: data.trackId || previousState.trackId,
      title: data.title || previousState.title,
      artist: data.artist || previousState.artist,
      state: data.state || previousState.state,
      positionMs:
        data.positionMs != null ? data.positionMs : previousState.positionMs,
      durationMs:
        data.durationMs != null ? data.durationMs : previousState.durationMs,
      playMode: data.playMode || previousState.playMode,
    }
  }

  return previousState
}
