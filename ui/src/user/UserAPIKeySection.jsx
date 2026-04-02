import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormHelperText,
  LinearProgress,
  TextField,
} from '@material-ui/core'
import { alpha, makeStyles } from '@material-ui/core/styles'
import { useNotify, useTranslate } from 'react-admin'
import { httpClient } from '../dataProvider'

const useStyles = makeStyles((theme) => ({
  root: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
    width: 256,
  },
  actions: {
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    height: 40,
  },
  revokeButton: {
    color: theme.palette.error.main,
    borderColor: theme.palette.error.main,
    '&:hover': {
      borderColor: theme.palette.error.main,
      backgroundColor: alpha(theme.palette.error.main, 0.12),
      '@media (hover: none)': {
        backgroundColor: 'transparent',
      },
    },
  },
}))

const apiKeyUrl = (userId) => `/api/user/${userId}/apikey`
const maskedAPIKeyValue = '************************'

export const UserAPIKeySection = ({ userId }) => {
  const classes = useStyles()
  const notify = useNotify()
  const translate = useTranslate()
  const [hasActiveAPIKey, setHasActiveAPIKey] = useState(false)
  const [dialogAPIKey, setDialogAPIKey] = useState('')
  const [showAPIKeyDialog, setShowAPIKeyDialog] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const syncActiveAPIKey = useCallback((response) => {
    const isActive = !!response?.json?.active
    setHasActiveAPIKey(isActive)
    if (!isActive) {
      localStorage.removeItem('apiKey')
    }
  }, [])

  const closeAPIKeyDialog = useCallback(() => {
    setShowAPIKeyDialog(false)
    setDialogAPIKey('')
  }, [])

  const loadAPIKey = useCallback(() => {
    setLoading(true)
    return httpClient(apiKeyUrl(userId))
      .then((response) => {
        syncActiveAPIKey(response)
        closeAPIKeyDialog()
      })
      .catch((error) => {
        notify(
          error?.message || 'resources.user.notifications.apiKeyLoadError',
          'warning',
        )
      })
      .finally(() => {
        setLoading(false)
      })
  }, [closeAPIKeyDialog, notify, syncActiveAPIKey, userId])

  useEffect(() => {
    loadAPIKey()
  }, [loadAPIKey])

  const copyAPIKey = useCallback(
    (event) => {
      if (!dialogAPIKey) {
        return
      }

      event.target.select()
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard
          .writeText(dialogAPIKey)
          .then(() => {
            notify('resources.user.notifications.apiKeyCopied', 'info')
          })
          .catch((error) => {
            notify(
              error?.message || 'resources.user.notifications.apiKeyCopyError',
              'warning',
            )
          })
      } else {
        window.prompt(
          translate('resources.user.message.apiKeyCopyFallback'),
          dialogAPIKey,
        )
      }
    },
    [dialogAPIKey, notify, translate],
  )

  const revokeAPIKey = () => {
    setSubmitting(true)
    httpClient(apiKeyUrl(userId), { method: 'DELETE' })
      .then((response) => {
        syncActiveAPIKey(response)
        closeAPIKeyDialog()
        notify('resources.user.notifications.apiKeyRevoked', 'info')
      })
      .catch((error) => {
        notify(
          error?.message || 'resources.user.notifications.apiKeyRevokeError',
          'warning',
        )
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const generateAPIKey = () => {
    const notificationKey = hasActiveAPIKey
      ? 'resources.user.notifications.apiKeyRegenerated'
      : 'resources.user.notifications.apiKeyGenerated'

    setSubmitting(true)
    httpClient(apiKeyUrl(userId), { method: 'POST' })
      .then((response) => {
        const nextAPIKey = response?.json?.apiKey || ''
        if (!nextAPIKey) {
          notify('resources.user.notifications.apiKeyGenerateError', 'warning')
          return
        }

        setHasActiveAPIKey(true)
        setDialogAPIKey(nextAPIKey)
        setShowAPIKeyDialog(true)
        localStorage.setItem('apiKey', nextAPIKey)
        notify(notificationKey, 'info')
      })
      .catch((error) => {
        notify(
          error?.message || 'resources.user.notifications.apiKeyGenerateError',
          'warning',
        )
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  if (loading) {
    return <LinearProgress data-testid="user-api-key-loading" />
  }

  return (
    <>
      <FormControl className={`${classes.root} ra-input ra-input-APIKey`}>
        <TextField
          fullWidth
          label={translate('resources.user.fields.apiKey')}
          margin="dense"
          value={hasActiveAPIKey ? maskedAPIKeyValue : ''}
          variant="outlined"
          InputProps={{ readOnly: true }}
        />
        <FormHelperText>
          {translate(
            hasActiveAPIKey
              ? 'resources.user.helperTexts.apiKeyHidden'
              : 'resources.user.helperTexts.apiKeyMissing',
          )}
        </FormHelperText>
        <div className={classes.actions}>
          <Button
            color="primary"
            variant="outlined"
            disabled={submitting}
            onClick={generateAPIKey}
          >
            {translate(
              hasActiveAPIKey
                ? 'resources.user.actions.regenerateApiKey'
                : 'resources.user.actions.generateApiKey',
            )}
          </Button>
          {hasActiveAPIKey && (
            <Button
              variant="outlined"
              disabled={submitting}
              className={classes.revokeButton}
              onClick={revokeAPIKey}
            >
              {translate('resources.user.actions.revokeApiKey')}
            </Button>
          )}
        </div>
      </FormControl>
      <Dialog
        open={showAPIKeyDialog}
        onClose={closeAPIKeyDialog}
        aria-labelledby="api-key-dialog-title"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="api-key-dialog-title">
          {translate('resources.user.message.apiKeyRevealTitle')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {translate('resources.user.message.apiKeyRevealMessage')}
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label={translate('resources.user.fields.apiKey')}
            margin="dense"
            value={dialogAPIKey}
            variant="outlined"
            helperText={translate('resources.user.message.apiKeyCopyHint')}
            inputProps={{
              readOnly: true,
              onClick: copyAPIKey,
              onFocus: (event) => event.target.select(),
              style: { cursor: 'copy', fontFamily: 'monospace' },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAPIKeyDialog} color="primary">
            {translate('ra.action.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
