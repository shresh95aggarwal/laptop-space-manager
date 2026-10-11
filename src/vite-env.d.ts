/// <reference types="vite/client" />

type FileSummary = {
  path: string
  name: string
  extension: string
  size: number
  modifiedAt: string
  folder: string
}

type FolderSummary = {
  path: string
  name: string
  parentPath: string | null
  size: number
  count: number
}

type TypeSummary = {
  extension: string
  size: number
  count: number
}

type DuplicateGroup = {
  hash: string
  size: number
  files: FileSummary[]
}

type ScanResult = {
  rootPath: string
  scannedAt: string
  durationMs: number
  totals: {
    files: number
    size: number
    duplicateGroups: number
    duplicateBytes: number
    errors: number
    emptyFolders: number
  }
  files: FileSummary[]
  largestFiles: FileSummary[]
  largestFolders: FolderSummary[]
  emptyFolders: FolderSummary[]
  fileTypes: TypeSummary[]
  duplicateGroups: DuplicateGroup[]
  errors: { path: string; message: string }[]
}

type ScanProgress = {
  phase?: 'scanning' | 'hashing'
  currentPath: string
  filesScanned: number
  foldersScanned: number
  bytesScanned: number
  filesHashed?: number
  totalToHash?: number
  startedAt?: string
  elapsedMs: number
}

type CommonLocation = {
  label: string
  path: string
}

interface Window {
  spaceManager: {
    pickFolder: () => Promise<string | null>
    pickFolders: () => Promise<string[]>
    getCommonLocations: () => Promise<CommonLocation[]>
    scanFolder: (folderPath: string) => Promise<ScanResult>
    cancelScan: () => Promise<boolean>
    findDuplicates: (folderPath: string) => Promise<Pick<ScanResult['totals'], 'duplicateBytes'> & { duplicateGroups: DuplicateGroup[] }>
    openPath: (filePath: string) => Promise<void>
    moveToTrash: (filePath: string) => Promise<boolean>
    onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
  }
}
