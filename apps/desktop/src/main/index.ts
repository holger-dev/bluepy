import { app } from 'electron'
import { registerIpc, session } from './ipc'
import { installMenu } from './menu'
import { windows } from './windows'

app.whenReady().then(async () => {
  registerIpc()
  await session.loadRecent()
  installMenu()
  void windows.open('main')
  // Discovery first (status bar), then reopen the last project like BlueJ does.
  await session.discover()
  await session.reopenLastProject()

  app.on('activate', () => {
    if (!windows.get('main')) void windows.open('main')
  })
})

// Closing the editor (main) window quits – see WindowManager.  Other windows
// closing on their own must not end the app.
app.on('window-all-closed', () => {
  /* handled by the main window's 'closed' handler */
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void session.stopBackend().finally(() => app.quit())
})
