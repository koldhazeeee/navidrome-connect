import { baseUrl } from './utils'
import throttle from 'lodash.throttle'
import { processEvent, serverDown, streamReconnected } from './actions'
import { REST_URL } from './consts'
import config from './config'
import connectDebug from './utils/connectDebug'

const newEventStream = async () => {
  let url = baseUrl(`${REST_URL}/events`)
  if (localStorage.getItem('token')) {
    url = url + `?jwt=${localStorage.getItem('token')}`
  }
  return new EventSource(url)
}

let eventStream
let reconnectTimer
const RECONNECT_DELAY = 5000

const stopEventStream = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (eventStream) {
    eventStream.close()
    eventStream = null
  }
}

const setupHandlers = (stream, dispatchFn) => {
  stream.addEventListener('serverStart', eventHandler(dispatchFn))
  stream.addEventListener('scanStatus', throttledEventHandler(dispatchFn))
  stream.addEventListener('refreshResource', eventHandler(dispatchFn))
  if (config.enableNowPlaying) {
    stream.addEventListener('nowPlayingCount', eventHandler(dispatchFn))
  }
  if (config.enableConnect) {
    stream.addEventListener('connectCommand', eventHandler(dispatchFn))
    stream.addEventListener('connectStateChanged', eventHandler(dispatchFn))
  }
  stream.addEventListener('keepAlive', eventHandler(dispatchFn))
  stream.onerror = (e) => {
    // eslint-disable-next-line no-console
    console.log('EventStream error', e)
    dispatchFn(serverDown())
    if (stream) {
      stream.close()
      if (eventStream === stream) {
        eventStream = null
      }
    }
    scheduleReconnect(dispatchFn)
  }
}

const scheduleReconnect = (dispatchFn) => {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect(dispatchFn)
    }, RECONNECT_DELAY)
  }
}

const connect = async (dispatchFn) => {
  try {
    const stream = await newEventStream()
    eventStream = stream
    setupHandlers(stream, dispatchFn)
    // Dispatch reconnection event to refresh critical data
    dispatchFn(streamReconnected())
    return stream
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`Error connecting to server:`, e)
    scheduleReconnect(dispatchFn)
  }
}

const eventHandler = (dispatchFn) => (event) => {
  const data = JSON.parse(event.data)
  if (event.type === 'connectCommand' || event.type === 'connectStateChanged') {
    connectDebug(`event ${event.type}`, data)
    const currentUsername = localStorage.getItem('username')
    if (data?.forUser && data.forUser !== currentUsername) {
      connectDebug(`ignored ${event.type}`, {
        currentUsername,
        eventUser: data.forUser,
      })
      return
    }
  }
  if (event.type !== 'keepAlive') {
    dispatchFn(processEvent(event.type, data))
  }
}

const throttledEventHandler = (dispatchFn) =>
  throttle(eventHandler(dispatchFn), 100, { trailing: true })

const startEventStreamLegacy = async (dispatchFn) => {
  stopEventStream()
  return newEventStream()
    .then((newStream) => {
      eventStream = newStream
      newStream.addEventListener('serverStart', eventHandler(dispatchFn))
      newStream.addEventListener(
        'scanStatus',
        throttledEventHandler(dispatchFn),
      )
      newStream.addEventListener('refreshResource', eventHandler(dispatchFn))
      if (config.enableNowPlaying) {
        newStream.addEventListener('nowPlayingCount', eventHandler(dispatchFn))
      }
      if (config.enableConnect) {
        newStream.addEventListener('connectCommand', eventHandler(dispatchFn))
        newStream.addEventListener(
          'connectStateChanged',
          eventHandler(dispatchFn),
        )
      }
      newStream.addEventListener('keepAlive', eventHandler(dispatchFn))
      newStream.onerror = (e) => {
        // eslint-disable-next-line no-console
        console.log('EventStream error', e)
        dispatchFn(serverDown())
      }
      return newStream
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.log(`Error connecting to server:`, e)
    })
}

const startEventStreamNew = async (dispatchFn) => {
  stopEventStream()
  return connect(dispatchFn)
}

const startEventStream = async (dispatchFn) => {
  if (!localStorage.getItem('is-authenticated')) {
    stopEventStream()
    return Promise.resolve()
  }
  if (config.devNewEventStream) {
    return startEventStreamNew(dispatchFn)
  }
  return startEventStreamLegacy(dispatchFn)
}

export { startEventStream, stopEventStream }
