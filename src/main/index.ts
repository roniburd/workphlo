import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createWorkspace } from './workspace/workspace'
import { registerIpc } from './ipc'
import { createHookService } from './pty/hookService'
import { createCliSessions, type CliSessions } from './pty/cliSession'

let mainWindow: BrowserWindow | null = null

// Late-bound so the hook onHook closure can reach the controller created after it.
let cliRef: CliSessions | null = null

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app
  .whenReady()
  .then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const root = join(app.getPath('userData'), 'workspace')
    await createWorkspace(root)
    const send = (channel: string, payload: unknown): void =>
      mainWindow?.webContents.send(channel, payload)
    // The hook service must exist before cli sessions so start() can register tokens.
    const hooks = await createHookService({
      onHook: (sessionId) => cliRef?.recheck(sessionId)
    })
    const cli = createCliSessions({ root, hooks, send })
    // Give the hook callback a handle to the controller (created after hooks).
    cliRef = cli
    registerIpc(root, () => mainWindow, cli)

    // Reap every orphaned `claude` pty on quit — must not throw and block shutdown.
    app.on('before-quit', () => {
      try {
        cli.killAll()
      } catch (err) {
        console.error('killAll on quit failed', err)
      }
    })

    createWindow()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((err) => {
    console.error('startup failed', err)
    app.quit()
  })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
