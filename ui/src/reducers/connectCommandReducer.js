import { EVENT_CONNECT_COMMAND } from '../actions/serverEvents'

const initialState = {
  command: null,
  seq: 0,
}

export const connectCommandReducer = (
  previousState = initialState,
  { type, data },
) => {
  if (type !== EVENT_CONNECT_COMMAND) {
    return previousState
  }

  return {
    command: data,
    seq: previousState.seq + 1,
  }
}
