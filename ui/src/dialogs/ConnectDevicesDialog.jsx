import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNotify, useTranslate } from 'react-admin'
import {
  Button,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core'
import { makeStyles } from '@material-ui/core/styles'
import CheckIcon from '@material-ui/icons/Check'
import CloseIcon from '@material-ui/icons/Close'
import DesktopWindowsIcon from '@material-ui/icons/DesktopWindows'
import EditIcon from '@material-ui/icons/Edit'
import FiberManualRecordIcon from '@material-ui/icons/FiberManualRecord'
import PauseIcon from '@material-ui/icons/Pause'
import PhoneAndroidIcon from '@material-ui/icons/PhoneAndroid'
import PlayArrowIcon from '@material-ui/icons/PlayArrow'
import SkipNextIcon from '@material-ui/icons/SkipNext'
import SkipPreviousIcon from '@material-ui/icons/SkipPrevious'
import { closeConnectDevicesDialog } from '../actions'
import { clientUniqueId, httpClient } from '../dataProvider'
import subsonic from '../subsonic'
import connectDebug from '../utils/connectDebug'

const useStyles = makeStyles((theme) => ({
  title: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    paddingRight: theme.spacing(1),
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(3),
  },
  empty: {
    color: theme.palette.text.secondary,
    padding: theme.spacing(3),
    textAlign: 'center',
  },
  deviceName: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(1),
  },
  deviceItem: {
    paddingRight: theme.spacing(16),
  },
  deviceIcon: {
    minWidth: 36,
  },
  statusDot: {
    fontSize: 11,
  },
  online: {
    color: theme.palette.success.main,
  },
  offline: {
    color: theme.palette.text.disabled,
  },
  hostTag: {
    color: theme.palette.primary.main,
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  thisDevice: {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
  },
  controls: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(0.5),
    justifyContent: 'center',
  },
  secondaryActions: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  },
  controlButton: {
    padding: 4,
  },
  stateLine: {
    color: theme.palette.text.secondary,
    display: 'block',
    fontSize: '0.8rem',
    marginTop: theme.spacing(0.5),
  },
  transferButton: {
    minWidth: 0,
  },
  compactActionButton: {
    padding: theme.spacing(0.5, 0.75),
  },
  editNicknameButton: {
    marginLeft: theme.spacing(0.5),
    opacity: 0.5,
    padding: 2,
    '&:hover': {
      opacity: 1,
    },
  },
  editNicknameIcon: {
    fontSize: '0.85rem',
  },
  nicknameInput: {
    maxWidth: 180,
    '& input': {
      fontSize: '0.9rem',
      padding: '2px 4px',
    },
  },
  saveNicknameButton: {
    color: theme.palette.success.main,
    marginLeft: theme.spacing(0.25),
    padding: 2,
  },
}))

const formatTime = (ms = 0) => {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = `${totalSeconds % 60}`.padStart(2, '0')
  return `${minutes}:${seconds}`
}

const DeviceIcon = ({ name }) => {
  if (/phone|android|ios|mobile/i.test(name || '')) {
    return <PhoneAndroidIcon fontSize="small" />
  }
  return <DesktopWindowsIcon fontSize="small" />
}

export const ConnectDevicesDialog = () => {
  const classes = useStyles()
  const dispatch = useDispatch()
  const notify = useNotify()
  const translate = useTranslate()
  const { open } = useSelector((state) => state.connectDevicesDialog)
  const connectSession = useSelector((state) => state.connectSession)
  const currentTrack = useSelector((state) => state.player.current)
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState([])
  const [hostDeviceId, setHostDeviceId] = useState(null)
  const [editingDeviceId, setEditingDeviceId] = useState(null)
  const [nicknameInput, setNicknameInput] = useState('')
  const isCurrentDeviceHost = hostDeviceId === clientUniqueId
  const isCurrentDeviceFollower = connectSession?.isFollower === true

  const closeDialog = useCallback(() => {
    dispatch(closeConnectDevicesDialog())
  }, [dispatch])

  const fetchDevices = useCallback(() => {
    const apiUrl = subsonic.url('getConnectDevices')
    if (!apiUrl) {
      return Promise.resolve()
    }

    setLoading(true)
    return httpClient(apiUrl)
      .then(({ json }) => {
        const payload = json['subsonic-response']?.connectDevices
        const nextDevices = payload?.device || []
        const nextHostDeviceId = payload?.hostDeviceId || null
        nextDevices.sort((left, right) => {
          if (left.id === nextHostDeviceId) return -1
          if (right.id === nextHostDeviceId) return 1
          if (left.isOnline !== right.isOnline) return left.isOnline ? -1 : 1
          return left.name.localeCompare(right.name)
        })
        nextDevices.forEach((device) => {
          if (!device.nowPlaying) {
            return
          }
          connectDebug('device timer fetched', {
            deviceId: device.id,
            isHost: device.id === nextHostDeviceId,
            trackId: device.nowPlaying.trackId,
            state: device.nowPlaying.state,
            positionMs: device.nowPlaying.positionMs,
            durationMs: device.nowPlaying.durationMs,
            formattedPosition: formatTime(device.nowPlaying.positionMs),
            formattedDuration: formatTime(device.nowPlaying.durationMs),
          })
        })
        setDevices(nextDevices)
        setHostDeviceId(nextHostDeviceId)
      })
      .catch(() => {
        setDevices([])
        setHostDeviceId(null)
        notify('resources.connectDevices.notifications.loadError', {
          type: 'warning',
          messageArgs: { _: 'Unable to load connected devices' },
        })
      })
      .finally(() => {
        setLoading(false)
      })
  }, [notify])

  useEffect(() => {
    if (!open) {
      return undefined
    }
    fetchDevices()
    const interval = window.setInterval(fetchDevices, 1000)
    return () => window.clearInterval(interval)
  }, [fetchDevices, open])

  useEffect(() => {
    if (!open) {
      return
    }
    devices.forEach((device) => {
      if (!device.nowPlaying) {
        return
      }
      connectDebug('device timer render', {
        deviceId: device.id,
        isHost: device.id === hostDeviceId,
        trackId: device.nowPlaying.trackId,
        state: device.nowPlaying.state,
        positionMs: device.nowPlaying.positionMs,
        durationMs: device.nowPlaying.durationMs,
        renderedPosition: formatTime(device.nowPlaying.positionMs),
        renderedDuration: formatTime(device.nowPlaying.durationMs),
      })
    })
  }, [devices, hostDeviceId, open])

  const sendCommand = useCallback(
    (deviceId, command) => {
      const apiUrl = subsonic.url('sendConnectCommand', null, {
        deviceId,
        command,
      })
      if (!apiUrl) {
        return
      }
      httpClient(apiUrl)
        .then(() => window.setTimeout(fetchDevices, 250))
        .catch(() => {
          notify('resources.connectDevices.notifications.commandError', {
            type: 'warning',
            messageArgs: { _: 'Unable to send command' },
          })
        })
    },
    [fetchDevices, notify],
  )

  const transferPlayback = useCallback(
    (deviceId) => {
      const transferOptions = { deviceId }
      const hostDevice = devices.find((device) => device.id === hostDeviceId)
      if (hostDevice?.nowPlaying) {
        transferOptions.id = hostDevice.nowPlaying.trackId
        transferOptions.positionMs = hostDevice.nowPlaying.positionMs
        transferOptions.startPlaying = hostDevice.nowPlaying.state === 'playing'
      }

      if (
        (isCurrentDeviceHost || isCurrentDeviceFollower) &&
        currentTrack?.trackId
      ) {
        const audio = document.querySelector('audio')
        if (audio) {
          transferOptions.id = currentTrack.trackId
          transferOptions.positionMs = Math.max(
            Math.floor((audio.currentTime ?? 0) * 1000),
            0,
          )
          if (isCurrentDeviceHost || !hostDevice?.nowPlaying) {
            transferOptions.startPlaying = !audio.paused && !audio.ended
          }
        }
      }

      const apiUrl = subsonic.url('transferPlayback', null, transferOptions)
      if (!apiUrl) {
        return
      }
      httpClient(apiUrl)
        .then(() => {
          notify('resources.connectDevices.notifications.transferred', {
            type: 'info',
            messageArgs: { _: 'Playback transferred' },
          })
          window.setTimeout(fetchDevices, 250)
        })
        .catch(() => {
          notify('resources.connectDevices.notifications.transferError', {
            type: 'warning',
            messageArgs: { _: 'Unable to transfer playback' },
          })
        })
    },
    [
      currentTrack?.trackId,
      devices,
      fetchDevices,
      hostDeviceId,
      isCurrentDeviceFollower,
      isCurrentDeviceHost,
      notify,
    ],
  )

  const startEditNickname = useCallback((deviceId, currentName) => {
    setEditingDeviceId(deviceId)
    setNicknameInput(currentName === deviceId ? '' : currentName)
  }, [])

  const cancelEditNickname = useCallback(() => {
    setEditingDeviceId(null)
    setNicknameInput('')
  }, [])

  const saveNickname = useCallback(
    (deviceId) => {
      const apiUrl = subsonic.url('setDeviceNickname', null, {
        deviceId,
        nickname: nicknameInput.trim(),
      })
      if (!apiUrl) {
        return
      }
      httpClient(apiUrl)
        .then(() => {
          setEditingDeviceId(null)
          setNicknameInput('')
          fetchDevices()
        })
        .catch(() => {
          notify('resources.connectDevices.notifications.nicknameError', {
            type: 'warning',
            messageArgs: { _: 'Unable to save nickname' },
          })
        })
    },
    [fetchDevices, nicknameInput, notify],
  )

  const body = useMemo(() => {
    if (loading && devices.length === 0) {
      return (
        <div className={classes.loading}>
          <CircularProgress size={32} />
        </div>
      )
    }

    if (devices.length === 0) {
      return (
        <Typography className={classes.empty}>
          {translate('resources.connectDevices.none', {
            _: 'No connected devices found.',
          })}
        </Typography>
      )
    }

    return (
      <List>
        {devices.map((device, index) => {
          const isHost = device.id === hostDeviceId
          const isThisDevice = device.id === clientUniqueId
          const primaryName = device.name || device.client || device.id
          const nicknamePlaceholder = `${device.id.slice(0, 8)}...`
          let secondary
          if (!isHost && hostDeviceId) {
            secondary = (
              <span className={classes.stateLine}>
                {translate('resources.connectDevices.following', {
                  _: 'Following',
                })}
              </span>
            )
          } else if (device.nowPlaying) {
            secondary = (
              <>
                <span>{`${device.nowPlaying.title} - ${device.nowPlaying.artist}`}</span>
                <span className={classes.stateLine}>
                  {`${device.nowPlaying.state} - ${formatTime(
                    device.nowPlaying.positionMs,
                  )} / ${formatTime(device.nowPlaying.durationMs)}`}
                </span>
              </>
            )
          } else {
            secondary = (
              <span className={classes.stateLine}>
                {device.isOnline ? 'Idle' : 'Offline'}
              </span>
            )
          }

          return (
            <React.Fragment key={device.id}>
              {index > 0 && <Divider />}
              <ListItem className={classes.deviceItem}>
                <ListItemIcon className={classes.deviceIcon}>
                  <Tooltip title={device.isOnline ? 'Online' : 'Offline'}>
                    <span>
                      <DeviceIcon name={primaryName} />
                      <FiberManualRecordIcon
                        className={`${classes.statusDot} ${
                          device.isOnline ? classes.online : classes.offline
                        }`}
                      />
                    </span>
                  </Tooltip>
                </ListItemIcon>
                <ListItemText
                  primary={
                    <span className={classes.deviceName}>
                      {editingDeviceId === device.id ? (
                        <>
                          <TextField
                            autoFocus
                            className={classes.nicknameInput}
                            inputProps={{
                              'data-testid': `nickname-input-${device.id}`,
                            }}
                            onChange={(event) =>
                              setNicknameInput(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') saveNickname(device.id)
                              if (event.key === 'Escape') cancelEditNickname()
                            }}
                            placeholder={nicknamePlaceholder}
                            size="small"
                            value={nicknameInput}
                          />
                          <IconButton
                            className={classes.saveNicknameButton}
                            data-testid={`save-nickname-${device.id}`}
                            onClick={() => saveNickname(device.id)}
                            size="small"
                          >
                            <CheckIcon className={classes.editNicknameIcon} />
                          </IconButton>
                        </>
                      ) : (
                        <>
                          <span>{primaryName}</span>
                          <IconButton
                            className={classes.editNicknameButton}
                            data-testid={`edit-nickname-${device.id}`}
                            onClick={() =>
                              startEditNickname(
                                device.id,
                                device.name || device.id,
                              )
                            }
                            size="small"
                            title="Edit nickname"
                          >
                            <EditIcon className={classes.editNicknameIcon} />
                          </IconButton>
                        </>
                      )}
                      {isHost && <span className={classes.hostTag}>HOST</span>}
                      {isThisDevice && (
                        <span className={classes.thisDevice}>
                          {translate('resources.connectDevices.thisDevice', {
                            _: '(This device)',
                          })}
                        </span>
                      )}
                    </span>
                  }
                  secondary={secondary}
                />
                {device.isOnline && (
                  <ListItemSecondaryAction>
                    <div className={classes.secondaryActions}>
                      {isHost && device.nowPlaying && (
                        <div className={classes.controls}>
                          <IconButton
                            className={classes.controlButton}
                            onClick={() => sendCommand(device.id, 'prev')}
                            size="small"
                          >
                            <SkipPreviousIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            className={classes.controlButton}
                            onClick={() =>
                              sendCommand(
                                device.id,
                                device.nowPlaying?.state === 'playing'
                                  ? 'pause'
                                  : 'resume',
                              )
                            }
                            size="small"
                          >
                            {device.nowPlaying?.state === 'playing' ? (
                              <PauseIcon fontSize="small" />
                            ) : (
                              <PlayArrowIcon fontSize="small" />
                            )}
                          </IconButton>
                          <IconButton
                            className={classes.controlButton}
                            onClick={() => sendCommand(device.id, 'next')}
                            size="small"
                          >
                            <SkipNextIcon fontSize="small" />
                          </IconButton>
                        </div>
                      )}
                      {isCurrentDeviceHost && !isThisDevice && (
                        <Button
                          className={`${classes.transferButton} ${classes.compactActionButton}`}
                          color="primary"
                          onClick={() => transferPlayback(device.id)}
                          size="small"
                          data-testid={`transfer-${device.id}`}
                          variant="outlined"
                        >
                          {translate('resources.connectDevices.transfer', {
                            _: 'Transfer',
                          })}
                        </Button>
                      )}
                      {isCurrentDeviceFollower && isHost && (
                        <Button
                          className={`${classes.transferButton} ${classes.compactActionButton}`}
                          color="primary"
                          onClick={() => transferPlayback(clientUniqueId)}
                          size="small"
                          data-testid="take-over"
                          variant="contained"
                        >
                          {translate('resources.connectDevices.takeOver', {
                            _: 'Take Over',
                          })}
                        </Button>
                      )}
                    </div>
                  </ListItemSecondaryAction>
                )}
              </ListItem>
            </React.Fragment>
          )
        })}
      </List>
    )
  }, [
    classes,
    devices,
    hostDeviceId,
    isCurrentDeviceFollower,
    isCurrentDeviceHost,
    loading,
    sendCommand,
    transferPlayback,
    translate,
    editingDeviceId,
    nicknameInput,
    cancelEditNickname,
    saveNickname,
    startEditNickname,
  ])

  return (
    <Dialog fullWidth maxWidth="sm" onClose={closeDialog} open={open}>
      <DialogTitle disableTypography className={classes.title}>
        <Typography variant="h6">
          {translate('resources.connectDevices.title', {
            _: 'Connected devices',
          })}
        </Typography>
        <IconButton onClick={closeDialog} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>{body}</DialogContent>
      <DialogActions>
        <Button onClick={fetchDevices}>
          {translate('resources.connectDevices.refresh', { _: 'Refresh' })}
        </Button>
        <Button color="primary" onClick={closeDialog}>
          {translate('ra.action.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
