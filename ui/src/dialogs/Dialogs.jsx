import { AddToPlaylistDialog } from './AddToPlaylistDialog'
import { ConnectDevicesDialog } from './ConnectDevicesDialog'
import DownloadMenuDialog from './DownloadMenuDialog'
import { HelpDialog } from './HelpDialog'
import { ShareDialog } from './ShareDialog'
import { SaveQueueDialog } from './SaveQueueDialog'

export const Dialogs = (props) => (
  <>
    <AddToPlaylistDialog />
    <ConnectDevicesDialog />
    <SaveQueueDialog />
    <DownloadMenuDialog />
    <HelpDialog />
    <ShareDialog />
  </>
)
