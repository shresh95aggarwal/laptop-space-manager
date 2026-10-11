const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const isDev = !app.isPackaged
let activeScan = null

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'Laptop Space Manager',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder to scan',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('pick-folders', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose folders to scan',
    properties: ['openDirectory', 'multiSelections'],
  })

  if (result.canceled || result.filePaths.length === 0) return []
  return result.filePaths
})

ipcMain.handle('get-common-locations', async () => {
  return [
    { label: 'Desktop', path: app.getPath('desktop') },
    { label: 'Documents', path: app.getPath('documents') },
    { label: 'Downloads', path: app.getPath('downloads') },
    { label: 'Pictures', path: app.getPath('pictures') },
    { label: 'Videos', path: app.getPath('videos') },
    { label: 'Music', path: app.getPath('music') },
  ]
})

ipcMain.handle('open-path', async (_event, filePath) => {
  return shell.showItemInFolder(filePath)
})

ipcMain.handle('move-to-trash', async (_event, filePath) => {
  await shell.trashItem(filePath)
  return true
})

ipcMain.handle('scan-folder', async (_event, folderPath) => {
  activeScan = { cancelled: false }

  try {
    return await scanFolder(folderPath, {
      signal: activeScan,
      onProgress: (progress) => _event.sender.send('scan-progress', progress),
    })
  } finally {
    activeScan = null
  }
})

ipcMain.handle('cancel-scan', async () => {
  if (activeScan) {
    activeScan.cancelled = true
    return true
  }

  return false
})

ipcMain.handle('find-duplicates', async (_event, folderPath) => {
  const scanResult = await scanFolder(folderPath)
  const duplicateGroups = await findDuplicates(scanResult.files)
  const duplicateBytes = duplicateGroups.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0)

  return {
    duplicateGroups,
    duplicateBytes,
  }
})

const ignoredNames = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '$Recycle.Bin',
  'System Volume Information',
])

async function scanFolder(rootPath, options = {}) {
  const startedAt = Date.now()
  const files = []
  const errors = []
  const folders = new Map()
  const types = new Map()
  const progress = {
    currentPath: rootPath,
    filesScanned: 0,
    foldersScanned: 0,
    bytesScanned: 0,
    startedAt: new Date(startedAt).toISOString(),
  }

  ensureFolder(folders, rootPath, null, path.basename(rootPath) || rootPath)

  function throwIfCancelled() {
    if (options.signal?.cancelled) {
      const error = new Error('Scan cancelled by user.')
      error.code = 'SCAN_CANCELLED'
      throw error
    }
  }

  function reportProgress(force = false) {
    if (!options.onProgress) return
    if (!force && progress.filesScanned % 100 !== 0) return

    options.onProgress({
      ...progress,
      elapsedMs: Date.now() - startedAt,
    })
  }

  async function walk(currentPath) {
    throwIfCancelled()
    ensureFolder(folders, currentPath, path.dirname(currentPath), path.basename(currentPath) || currentPath)
    progress.currentPath = currentPath
    progress.foldersScanned += 1
    reportProgress(true)

    let entries

    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch (error) {
      errors.push({ path: currentPath, message: error.message })
      return
    }

    for (const entry of entries) {
      throwIfCancelled()
      if (ignoredNames.has(entry.name)) continue

      const entryPath = path.join(currentPath, entry.name)

      try {
        if (entry.isDirectory()) {
          ensureFolder(folders, entryPath, currentPath, entry.name)
          await walk(entryPath)
          continue
        }

        if (!entry.isFile()) continue

        const stat = await fs.stat(entryPath)
        const extension = getExtension(entry.name)
        const folder = currentPath

        const file = {
          path: entryPath,
          name: entry.name,
          extension,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          folder,
        }

        files.push(file)
        addFolderSize(folders, folder, stat.size)
        addType(types, extension, stat.size)
        progress.filesScanned += 1
        progress.bytesScanned += stat.size
        reportProgress()
      } catch (error) {
        errors.push({ path: entryPath, message: error.message })
      }
    }
  }

  await walk(rootPath)
  reportProgress(true)

  const allFoldersList = mapToSortedArray(folders).filter((folder) => folder.path !== rootPath)
  const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 250)
  const largestFolders = allFoldersList.slice(0, 500)
  const emptyFolders = allFoldersList.filter((folder) => folder.count === 0)
  const fileTypes = [...types.values()].sort((a, b) => b.size - a.size)

  return {
    rootPath,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    totals: {
      files: files.length,
      size: files.reduce((sum, file) => sum + file.size, 0),
      duplicateGroups: 0,
      duplicateBytes: 0,
      errors: errors.length,
      emptyFolders: emptyFolders.length,
    },
    files,
    largestFiles,
    largestFolders,
    emptyFolders,
    fileTypes,
    duplicateGroups: [],
    errors: errors.slice(0, 100),
  }
}

function getExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  return extension || '[no extension]'
}

function ensureFolder(map, folderPath, parentPath, displayName) {
  if (map.has(folderPath)) return map.get(folderPath)

  const folder = {
    path: folderPath,
    name: displayName,
    parentPath,
    size: 0,
    count: 0,
  }

  map.set(folderPath, folder)
  return folder
}

function addFolderSize(map, folderPath, size) {
  let currentPath = folderPath

  while (currentPath && map.has(currentPath)) {
    const existing = map.get(currentPath)
    existing.size += size
    existing.count += 1
    currentPath = existing.parentPath
  }
}

function addType(map, extension, size) {
  const existing = map.get(extension) || { extension, size: 0, count: 0 }
  existing.size += size
  existing.count += 1
  map.set(extension, existing)
}

function mapToSortedArray(map) {
  return [...map.values()].sort((a, b) => b.size - a.size)
}

async function findDuplicates(files) {
  const bySize = new Map()

  for (const file of files) {
    if (file.size === 0) continue
    const group = bySize.get(file.size) || []
    group.push(file)
    bySize.set(file.size, group)
  }

  const duplicateGroups = []

  for (const sameSizeFiles of bySize.values()) {
    if (sameSizeFiles.length < 2) continue

    const byHash = new Map()

    for (const file of sameSizeFiles) {
      try {
        const hash = await hashFile(file.path)
        const group = byHash.get(hash) || []
        group.push(file)
        byHash.set(hash, group)
      } catch {
        // Ignore files that cannot be read
      }
    }

    for (const [hash, group] of byHash.entries()) {
      if (group.length > 1) {
        duplicateGroups.push({ hash, size: group[0].size, files: group })
      }
    }
  }

  return duplicateGroups.sort((a, b) => b.size * b.files.length - a.size * a.files.length).slice(0, 100)
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
