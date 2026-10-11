const electron = require('electron')
const { app, BrowserWindow, dialog, ipcMain, shell } = electron || {}
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const isDev = app ? !app.isPackaged : true
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

if (app) {
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
    if (!filePath) return false
    const normalizedPath = path.normalize(path.resolve(filePath))
    return shell.showItemInFolder(normalizedPath)
  })

  ipcMain.handle('move-to-trash', async (_event, filePath) => {
    return moveToTrash(filePath)
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
    activeScan = { cancelled: false }

    try {
      const scanResult = await scanFolder(folderPath, {
        signal: activeScan,
        onProgress: (progress) => _event.sender.send('scan-progress', progress),
      })

      const duplicateGroups = await findDuplicates(scanResult.files, {
        signal: activeScan,
        onProgress: (progress) => _event.sender.send('scan-progress', progress),
      })

      const duplicateBytes = duplicateGroups.reduce(
        (sum, group) => sum + group.size * (group.files.length - 1),
        0
      )

      return {
        duplicateGroups,
        duplicateBytes,
      }
    } finally {
      activeScan = null
    }
  })
}

/**
 * Move file or directory to the OS Recycle Bin.
 * SAFETY RULE: Never fall back to permanent deletion (such as fs.rm).
 * If trashItem fails, return/throw a clear error preserving the item.
 *
 * @param {string} filePath - Path to file or folder
 * @param {object} [options] - Optional dependencies for testing/injection
 * @param {(path: string) => Promise<void>} [options.trashItem] - Custom trash function
 */
async function moveToTrash(filePath, options = {}) {
  if (!filePath) {
    throw new Error('Path must be specified')
  }

  const normalizedPath = path.normalize(path.resolve(filePath))
  const trashFn = options.trashItem || (shell ? (p) => shell.trashItem(p) : null)

  if (!trashFn) {
    throw new Error(`Failed to move "${path.basename(normalizedPath)}" to Recycle Bin: shell.trashItem is unavailable in this environment. File was preserved.`)
  }

  try {
    await trashFn(normalizedPath)
    return true
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error)
    console.error(`Failed to move "${normalizedPath}" to Recycle Bin: ${errMessage}`)
    throw new Error(`Failed to move "${path.basename(normalizedPath)}" to Recycle Bin: ${errMessage}. File was preserved.`)
  }
}

const ignoredNames = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '$Recycle.Bin',
  'System Volume Information',
])

/**
 * Scan a directory tree.
 * Empty folder definition:
 * A folder is considered empty if it contains 0 regular files in itself or any
 * of its subdirectories (excluding ignored system/build directories).
 */
async function scanFolder(rootPath, options = {}) {
  const startedAt = Date.now()
  const files = []
  const errors = []
  const folders = new Map()
  const types = new Map()
  const progress = {
    phase: 'scanning',
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
      if (error && error.code === 'SCAN_CANCELLED') {
        throw error
      }
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
        if (error && error.code === 'SCAN_CANCELLED') {
          throw error
        }
        errors.push({ path: entryPath, message: error.message })
      }
    }
  }

  await walk(rootPath)
  reportProgress(true)

  const allFoldersList = mapToSortedArray(folders).filter((folder) => folder.path !== rootPath)
  const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 250)
  const largestFolders = allFoldersList.slice(0, 500)
  // Consistent empty folder definition: folders with zero file count (direct or nested)
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

/**
 * Find duplicate files by grouping by identical byte size,
 * then computing streaming SHA-256 hashes.
 * Supports cancellation signal and hashing progress reporting.
 */
async function findDuplicates(files, options = {}) {
  function throwIfCancelled() {
    if (options.signal?.cancelled) {
      const error = new Error('Scan cancelled by user.')
      error.code = 'SCAN_CANCELLED'
      throw error
    }
  }

  throwIfCancelled()

  const bySize = new Map()

  for (const file of files) {
    if (file.size === 0) continue
    const group = bySize.get(file.size) || []
    group.push(file)
    bySize.set(file.size, group)
  }

  // Calculate candidate files that need hashing (only size groups >= 2)
  const candidateFiles = []
  for (const sameSizeFiles of bySize.values()) {
    if (sameSizeFiles.length >= 2) {
      candidateFiles.push(...sameSizeFiles)
    }
  }

  const totalToHash = candidateFiles.length
  let hashedCount = 0

  const duplicateGroups = []

  for (const sameSizeFiles of bySize.values()) {
    throwIfCancelled()
    if (sameSizeFiles.length < 2) continue

    const byHash = new Map()

    for (const file of sameSizeFiles) {
      throwIfCancelled()

      if (options.onProgress) {
        options.onProgress({
          phase: 'hashing',
          currentPath: file.path,
          filesScanned: files.length,
          filesHashed: hashedCount,
          totalToHash,
          bytesScanned: 0,
          foldersScanned: 0,
          elapsedMs: 0,
        })
      }

      try {
        const hash = await hashFile(file.path, options.signal)
        const group = byHash.get(hash) || []
        group.push(file)
        byHash.set(hash, group)
      } catch (err) {
        if (err.code === 'SCAN_CANCELLED') {
          throw err
        }
        // Skip unreadable files
      }

      hashedCount++

      if (options.onProgress) {
        options.onProgress({
          phase: 'hashing',
          currentPath: file.path,
          filesScanned: files.length,
          filesHashed: hashedCount,
          totalToHash,
          bytesScanned: 0,
          foldersScanned: 0,
          elapsedMs: 0,
        })
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

/**
 * Computes SHA-256 hash using streaming to avoid loading large files into memory.
 * Checks for cancellation periodically during streaming.
 */
function hashFile(filePath, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.cancelled) {
      const err = new Error('Scan cancelled by user.')
      err.code = 'SCAN_CANCELLED'
      return reject(err)
    }

    const hash = crypto.createHash('sha256')
    const stream = fsSync.createReadStream(filePath)

    stream.on('data', (chunk) => {
      if (signal?.cancelled) {
        stream.destroy()
        const err = new Error('Scan cancelled by user.')
        err.code = 'SCAN_CANCELLED'
        return reject(err)
      }
      hash.update(chunk)
    })

    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })

    stream.on('error', (err) => {
      reject(err)
    })
  })
}

module.exports = {
  scanFolder,
  findDuplicates,
  hashFile,
  moveToTrash,
}
