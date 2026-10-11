const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spaceManager', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFolders: () => ipcRenderer.invoke('pick-folders'),
  getCommonLocations: () => ipcRenderer.invoke('get-common-locations'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  cancelScan: () => ipcRenderer.invoke('cancel-scan'),
  findDuplicates: (folderPath) => ipcRenderer.invoke('find-duplicates', folderPath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  moveToTrash: (filePath) => ipcRenderer.invoke('move-to-trash', filePath),
  onScanProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('scan-progress', listener)
    return () => ipcRenderer.removeListener('scan-progress', listener)
  },
})
