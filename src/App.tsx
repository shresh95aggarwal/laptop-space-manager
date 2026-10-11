import { Component, ErrorInfo, ReactNode, useEffect, useMemo, useState } from 'react'

type Tab = 'browse' | 'files' | 'types' | 'duplicates' | 'cleanup' | 'jobs' | 'errors'
type ViewMode = 'list' | 'tiles'
type ScanJob = {
  id: string
  path: string
  status: 'waiting' | 'running' | 'complete' | 'cancelled' | 'failed'
  result?: ScanResult
  error?: string
}

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'sans-serif', color: '#172033' }}>
          <h2>Something went wrong in the UI</h2>
          <p style={{ color: '#b91c1c' }}>{this.state.error?.message || 'Unknown error'}</p>
          <button
            style={{ padding: '10px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
          >
            Reload App
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string>('')
  const [commonLocations, setCommonLocations] = useState<CommonLocation[]>([])
  const [currentFolder, setCurrentFolder] = useState<string>('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('browse')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [isScanning, setIsScanning] = useState(false)
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [minSizeMb, setMinSizeMb] = useState('')
  const [cleanupQueue, setCleanupQueue] = useState<FileSummary[]>([])
  const [diskSpace, setDiskSpace] = useState<{ total: number; free: number; used: number } | null>(null)
  const [message, setMessage] = useState('Select one or more folders to begin scanning.')

  useEffect(() => {
    window.spaceManager.getCommonLocations().then(setCommonLocations).catch(() => setCommonLocations([]))
    return window.spaceManager.onScanProgress(setScanProgress)
  }, [])

  const childFolders = useMemo(() => {
    if (!result || !currentFolder) return []
    let folders = (result.largestFolders || []).filter((folder) => folder.parentPath === currentFolder)

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase()
      folders = folders.filter((folder) => (folder.name || '').toLowerCase().includes(q) || (folder.path || '').toLowerCase().includes(q))
    }

    return folders.sort((a, b) => (b.size || 0) - (a.size || 0))
  }, [currentFolder, result, searchTerm])

  const currentFiles = useMemo(() => {
    if (!result || !currentFolder) return []
    return applyFileFilters((result.files || []).filter((file) => file.folder === currentFolder), searchTerm, categoryFilter, minSizeMb)
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 250)
  }, [categoryFilter, currentFolder, minSizeMb, result, searchTerm])

  const filteredLargestFiles = useMemo(() => {
    if (!result) return []
    return applyFileFilters(result.largestFiles || [], searchTerm, categoryFilter, minSizeMb)
  }, [categoryFilter, minSizeMb, result, searchTerm])

  const cleanupSuggestions = useMemo(() => {
    if (!result) return []
    return buildCleanupSuggestions(result.files || [])
  }, [result])

  const duplicateFiles = useMemo(
    () => (result?.duplicateGroups || []).flatMap((group) => (group.files || []).slice(1)),
    [result],
  )

  async function chooseFolders() {
    const folders = await window.spaceManager.pickFolders()
    if (folders && folders.length > 0) {
      const updated = unique([...selectedLocations, ...folders])
      setSelectedLocations(updated)
      setActiveFolder(folders[0])
      setMessage(`${folders.length} folder(s) selected. Ready to scan.`)
    }
  }

  function addCommonLocation(path: string) {
    const updated = unique([...selectedLocations, path])
    setSelectedLocations(updated)
    setActiveFolder(path)
    setMessage(`Added ${path} to scan locations. Ready to scan.`)
  }

  function removeLocation(path: string) {
    const updated = selectedLocations.filter((item) => item !== path)
    setSelectedLocations(updated)
    if (activeFolder === path) {
      setActiveFolder(updated[0] || '')
    }
  }

  function clearAllLocations() {
    setSelectedLocations([])
    setActiveFolder('')
    setResult(null)
    setMessage('Select one or more folders to begin scanning.')
  }

  async function startFastScan() {
    if (selectedLocations.length === 0) return

    setIsScanning(true)
    setScanProgress(null)
    setMessage('Fast scanning selected folder(s)...')

    const jobs: ScanJob[] = selectedLocations.map((path) => ({ id: crypto.randomUUID(), path, status: 'waiting' }))
    setScanJobs(jobs)

    let lastResult: ScanResult | null = null

    for (const job of jobs) {
      setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status: 'running' } : item))
      try {
        const scanResult = await window.spaceManager.scanFolder(job.path)
        lastResult = scanResult
        setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status: 'complete', result: scanResult } : item))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Scan failed.'
        const status = errorMessage.toLowerCase().includes('cancelled') ? 'cancelled' : 'failed'
        setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status, error: errorMessage } : item))
        if (status === 'cancelled') break
      }
    }

    if (lastResult) {
      setResult(lastResult)
      setCurrentFolder(lastResult.rootPath)
      setActiveTab('browse')
      setMessage(`Fast scan complete in ${((lastResult.durationMs || 0) / 1000).toFixed(1)}s!`)
      window.spaceManager.getDiskSpace(lastResult.rootPath).then(setDiskSpace).catch(() => {})
    }

    setIsScanning(false)
    setScanProgress(null)
  }

  async function startFullScan() {
    if (selectedLocations.length === 0) return

    setIsScanning(true)
    setIsFindingDuplicates(true)
    setScanProgress(null)
    setMessage('Full scanning (file sizes + duplicates) selected folder(s)...')

    const jobs: ScanJob[] = selectedLocations.map((path) => ({ id: crypto.randomUUID(), path, status: 'waiting' }))
    setScanJobs(jobs)

    let lastResult: ScanResult | null = null

    for (const job of jobs) {
      setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status: 'running' } : item))
      try {
        const scanResult = await window.spaceManager.scanFolder(job.path)
        const duplicateResult = await window.spaceManager.findDuplicates(job.path)

        const fullResult: ScanResult = {
          ...scanResult,
          duplicateGroups: duplicateResult.duplicateGroups || [],
          totals: {
            ...scanResult.totals,
            duplicateGroups: (duplicateResult.duplicateGroups || []).length,
            duplicateBytes: duplicateResult.duplicateBytes || 0,
          },
        }

        lastResult = fullResult
        setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status: 'complete', result: fullResult } : item))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Scan failed.'
        const status = errorMessage.toLowerCase().includes('cancelled') ? 'cancelled' : 'failed'
        setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status, error: errorMessage } : item))
        if (status === 'cancelled') break
      }
    }

    if (lastResult) {
      setResult(lastResult)
      setCurrentFolder(lastResult.rootPath)
      setActiveTab('browse')
      setMessage(`Full scan complete! All sizes, duplicates, and suggestions are ready.`)
      window.spaceManager.getDiskSpace(lastResult.rootPath).then(setDiskSpace).catch(() => {})
    }

    setIsScanning(false)
    setIsFindingDuplicates(false)
    setScanProgress(null)
  }

  async function cancelScan() {
    await window.spaceManager.cancelScan()
    setMessage('Cancelling scan...')
  }

  async function findDuplicates() {
    const targetFolder = activeFolder || selectedLocations[0]
    if (!targetFolder || !result) return

    setIsFindingDuplicates(true)
    setMessage('Finding duplicates by content hash...')

    try {
      const duplicateResult = await window.spaceManager.findDuplicates(targetFolder)
      setResult({
        ...result,
        duplicateGroups: duplicateResult.duplicateGroups || [],
        totals: {
          ...result.totals,
          duplicateGroups: (duplicateResult.duplicateGroups || []).length,
          duplicateBytes: duplicateResult.duplicateBytes || 0,
        },
      })
      setActiveTab('duplicates')
      setMessage(`Found ${(duplicateResult.duplicateGroups || []).length} duplicate group(s).`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Duplicate scan failed.')
    } finally {
      setIsFindingDuplicates(false)
    }
  }

  function addToCleanupQueue(file: FileSummary) {
    setCleanupQueue((items) => items.some((item) => item.path === file.path) ? items : [...items, file])
    setMessage('File added to cleanup queue.')
  }

  function removeFromCleanupQueue(filePath: string) {
    setCleanupQueue((items) => items.filter((item) => item.path !== filePath))
    setMessage('File removed from cleanup queue.')
  }

  function clearCleanupQueue() {
    setCleanupQueue([])
    setMessage('Cleanup queue reset and cleared.')
  }

  function removeDeletedFilesFromState(deletedPathsSet: Set<string>) {
    if (!result) return

    const remainingFiles = (result.files || []).filter((file) => !deletedPathsSet.has(file.path))
    const remainingLargestFiles = (result.largestFiles || []).filter((file) => !deletedPathsSet.has(file.path))

    const deletedBytes = (result.files || [])
      .filter((file) => deletedPathsSet.has(file.path))
      .reduce((sum, file) => sum + (file.size || 0), 0)

    const newDuplicateGroups = (result.duplicateGroups || [])
      .map((group) => ({
        ...group,
        files: group.files.filter((f) => !deletedPathsSet.has(f.path)),
      }))
      .filter((group) => group.files.length >= 2)

    const newDuplicateBytes = newDuplicateGroups.reduce((sum, group) => sum + (group.size || 0) * (group.files.length - 1), 0)

    setResult({
      ...result,
      files: remainingFiles,
      largestFiles: remainingLargestFiles,
      duplicateGroups: newDuplicateGroups,
      totals: {
        ...result.totals,
        files: remainingFiles.length,
        size: Math.max(0, (result.totals?.size || 0) - deletedBytes),
        duplicateGroups: newDuplicateGroups.length,
        duplicateBytes: newDuplicateBytes,
      },
    })
  }

  function removeDeletedFolderFromState(folderPath: string) {
    if (!result) return

    const normTarget = folderPath.replace(/[\\/]+$/, '').toLowerCase()
    const isSubPath = (p: string) => {
      const norm = (p || '').replace(/[\\/]+$/, '').toLowerCase()
      return norm === normTarget || norm.startsWith(normTarget + '\\') || norm.startsWith(normTarget + '/')
    }

    const deletedFiles = (result.files || []).filter((file) => isSubPath(file.path))
    const deletedBytes = deletedFiles.reduce((sum, file) => sum + (file.size || 0), 0)

    const remainingFiles = (result.files || []).filter((file) => !isSubPath(file.path))
    const remainingLargestFiles = (result.largestFiles || []).filter((file) => !isSubPath(file.path))
    const remainingLargestFolders = (result.largestFolders || []).filter((folder) => !isSubPath(folder.path))
    const remainingEmptyFolders = (result.emptyFolders || []).filter((folder) => !isSubPath(folder.path))

    const newDuplicateGroups = (result.duplicateGroups || [])
      .map((group) => ({
        ...group,
        files: group.files.filter((f) => !isSubPath(f.path)),
      }))
      .filter((group) => group.files.length >= 2)

    const newDuplicateBytes = newDuplicateGroups.reduce((sum, group) => sum + (group.size || 0) * (group.files.length - 1), 0)

    setResult({
      ...result,
      files: remainingFiles,
      largestFiles: remainingLargestFiles,
      largestFolders: remainingLargestFolders,
      emptyFolders: remainingEmptyFolders,
      duplicateGroups: newDuplicateGroups,
      totals: {
        ...result.totals,
        files: remainingFiles.length,
        size: Math.max(0, (result.totals?.size || 0) - deletedBytes),
        emptyFolders: remainingEmptyFolders.length,
        duplicateGroups: newDuplicateGroups.length,
        duplicateBytes: newDuplicateBytes,
      },
    })
  }

  async function moveQueuedFilesToTrash() {
    if (cleanupQueue.length === 0) return
    const totalSize = cleanupQueue.reduce((sum, file) => sum + (file.size || 0), 0)
    const confirmed = window.confirm(`Move ${cleanupQueue.length} file(s), ${formatBytes(totalSize)}, to the Recycle Bin?`)
    if (!confirmed) return

    const deletedSet = new Set<string>()
    let successCount = 0
    let failCount = 0

    for (const file of cleanupQueue) {
      try {
        await window.spaceManager.moveToTrash(file.path)
        deletedSet.add(file.path)
        successCount++
      } catch (err) {
        console.error('Failed to trash file:', file.path, err)
        failCount++
      }
    }

    if (deletedSet.size > 0) {
      removeDeletedFilesFromState(deletedSet)
    }

    setCleanupQueue((items) => items.filter((file) => !deletedSet.has(file.path)))

    if (failCount > 0) {
      setMessage(`Moved ${successCount} file(s) to Recycle Bin (${failCount} failed/locked).`)
    } else {
      setMessage(`Moved ${successCount} file(s) to the Recycle Bin and list refreshed!`)
    }
  }

  async function trashFolder(folderPath: string, folderName: string) {
    const confirmed = window.confirm(`Move folder "${folderName}" and all its contents to the Recycle Bin?\n\n${folderPath}`)
    if (!confirmed) return

    try {
      await window.spaceManager.moveToTrash(folderPath)
      removeDeletedFolderFromState(folderPath)
      setMessage(`Folder "${folderName}" moved to the Recycle Bin and removed from list!`)
    } catch (err) {
      console.error('Failed to trash folder:', folderPath, err)
      setMessage(`Failed to delete folder "${folderName}": ${err instanceof Error ? err.message : 'Permission or file locked'}`)
    }
  }

  return (
    <ErrorBoundary>
      <main className="app-shell">
        <section className="hero compact">
          <div>
            <p className="eyebrow">Laptop Space Manager</p>
            <h1>Manage storage folder by folder.</h1>
            <p className="intro">Fast scans, full scans, folder browsing, cleanup suggestions, and a safe Recycle Bin queue.</p>
          </div>

          <div className="scan-card">
            {selectedLocations.length === 0 ? (
              <div className="selection-step">
                <button className="primary-button" onClick={chooseFolders}>📁 Select folder(s) to scan</button>
                <p className="message">{message}</p>
              </div>
            ) : (
              <div className="scan-step">
                <div className="selected-banner">
                  <strong>Selected locations ({selectedLocations.length}):</strong>
                  <div className="location-tags">
                    {selectedLocations.map((path) => (
                      <span className="tag" key={path} title={path}>
                        {path}
                        <button className="tag-remove" onClick={() => removeLocation(path)}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="banner-actions">
                    <button className="small-button" onClick={chooseFolders}>+ Add folders</button>
                    <button className="small-button danger-text" onClick={clearAllLocations}>Clear all</button>
                  </div>
                </div>

                <div className="action-buttons">
                  {!isScanning ? (
                    <>
                      <button className="primary-button" onClick={startFastScan}>⚡ Fast scan</button>
                      <button className="primary-button full-scan-btn" onClick={startFullScan}>🔥 Full scan</button>
                    </>
                  ) : (
                    <button className="danger-button" onClick={cancelScan}>Cancel scan</button>
                  )}

                  {result && !isScanning && (
                    <button className="secondary-button" disabled={isFindingDuplicates} onClick={findDuplicates}>
                      {isFindingDuplicates ? 'Checking...' : '🔍 Find duplicates'}
                    </button>
                  )}
                </div>

                <p className="message">{message}</p>
                {scanProgress ? <ScanProgressCard progress={scanProgress} /> : null}
              </div>
            )}
          </div>
        </section>

        {selectedLocations.length === 0 && (
          <section className="quick-locations">
            <strong>Quick select:</strong>
            {commonLocations.map((location) => (
              <button key={location.path} onClick={() => addCommonLocation(location.path)}>{location.label}</button>
            ))}
          </section>
        )}

        {result ? (
          <>
            <section className="stats-grid">
              <Stat label="Scanned size" value={formatBytes(result.totals?.size || 0)} />
              <Stat label="Files found" value={(result.totals?.files || 0).toLocaleString()} />
              <Stat label="Empty folders" value={(result.totals?.emptyFolders || 0).toLocaleString()} />
              <Stat label="Errors / Skipped" value={(result.totals?.errors || 0).toLocaleString()} />
            </section>

            {diskSpace && (
              <section className="stat-card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span>Drive Capacity ({result.rootPath.slice(0, 2) || 'Active Drive'})</span>
                  <strong>{formatBytes(diskSpace.free)} free of {formatBytes(diskSpace.total)}</strong>
                </div>
                <div style={{ background: '#e2e8f0', borderRadius: '999px', height: '10px', overflow: 'hidden' }}>
                  <div style={{ background: '#2563eb', height: '100%', width: `${Math.min(100, Math.round((diskSpace.used / diskSpace.total) * 100))}%` }} />
                </div>
              </section>
            )}

            <section className="panel">
              <div className="toolbar">
                <div className="tabs">
                  <TabButton active={activeTab === 'browse'} onClick={() => setActiveTab('browse')}>Folder browser</TabButton>
                  <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')}>Largest files</TabButton>
                  <TabButton active={activeTab === 'types'} onClick={() => setActiveTab('types')}>File types</TabButton>
                  <TabButton active={activeTab === 'duplicates'} onClick={() => setActiveTab('duplicates')}>Duplicates ({duplicateFiles.length})</TabButton>
                  <TabButton active={activeTab === 'cleanup'} onClick={() => setActiveTab('cleanup')}>Cleanup ({cleanupQueue.length})</TabButton>
                  <TabButton active={activeTab === 'errors'} onClick={() => setActiveTab('errors')}>Errors / Skipped ({(result.errors || []).length})</TabButton>
                  <TabButton active={activeTab === 'jobs'} onClick={() => setActiveTab('jobs')}>Jobs ({scanJobs.length})</TabButton>
                </div>
                <div className="view-toggle" aria-label="View mode">
                  <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
                  <button className={viewMode === 'tiles' ? 'active' : ''} onClick={() => setViewMode('tiles')}>Tiles</button>
                </div>
              </div>

              <Filters categoryFilter={categoryFilter} minSizeMb={minSizeMb} folderMatchCount={childFolders.length} fileMatchCount={currentFiles.length} searchTerm={searchTerm} onCategoryChange={setCategoryFilter} onMinSizeChange={setMinSizeMb} onSearchChange={setSearchTerm} />

              {activeTab === 'browse' && (
                <FolderBrowser childFolders={childFolders} currentFiles={currentFiles} currentFolder={currentFolder} rootPath={result.rootPath} onFolderOpen={setCurrentFolder} onQueue={addToCleanupQueue} onTrashFolder={trashFolder} viewMode={viewMode} />
              )}
              {activeTab === 'files' && <FilesView files={filteredLargestFiles} onQueue={addToCleanupQueue} viewMode={viewMode} />}
              {activeTab === 'types' && <TypesTable types={result.fileTypes || []} />}
              {activeTab === 'duplicates' && <Duplicates groups={result.duplicateGroups || []} onQueue={addToCleanupQueue} />}
              {activeTab === 'cleanup' && (
                <CleanupPanel
                  emptyFolders={result.emptyFolders || []}
                  queue={cleanupQueue}
                  suggestions={cleanupSuggestions}
                  onClearQueue={clearCleanupQueue}
                  onMoveQueued={moveQueuedFilesToTrash}
                  onQueue={addToCleanupQueue}
                  onRemove={removeFromCleanupQueue}
                  onTrashFolder={trashFolder}
                />
              )}
              {activeTab === 'errors' && <ErrorsPanel errors={result.errors || []} />}
              {activeTab === 'jobs' && <JobsPanel jobs={scanJobs} selectedLocations={selectedLocations} onRemoveLocation={removeLocation} onUseResult={(scanResult) => { setResult(scanResult); setCurrentFolder(scanResult.rootPath); setActiveTab('browse') }} />}
            </section>
          </>
        ) : (
          <section className="empty-state">
            <h2>Recommended workflow</h2>
            <p>1. Select one or more folders above or use quick-select.</p>
            <p>2. Choose <strong>⚡ Fast scan</strong> for quick folder mapping or <strong>🔥 Full scan</strong> for deep scanning including duplicates.</p>
            <p>3. Use <strong>Folder browser</strong> and <strong>Cleanup suggestions</strong> to review and safely queue unwanted items to the Recycle Bin.</p>
          </section>
        )}
      </main>
    </ErrorBoundary>
  )
}

function Filters({
  searchTerm,
  categoryFilter,
  minSizeMb,
  folderMatchCount,
  fileMatchCount,
  onSearchChange,
  onCategoryChange,
  onMinSizeChange,
}: {
  searchTerm: string
  categoryFilter: string
  minSizeMb: string
  folderMatchCount: number
  fileMatchCount: number
  onSearchChange: (value: string) => void
  onCategoryChange: (value: string) => void
  onMinSizeChange: (value: string) => void
}) {
  return (
    <div className="filters-bar">
      <div className="filters">
        <input
          placeholder="🔎 Search folders and files in current view..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <select value={categoryFilter} onChange={(event) => onCategoryChange(event.target.value)}>
          <option value="all">All categories</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="audio">Audio</option>
          <option value="archive">Archives</option>
          <option value="document">Documents</option>
          <option value="installer">Installers</option>
        </select>
        <input
          min="0"
          placeholder="Min size MB"
          type="number"
          value={minSizeMb}
          onChange={(event) => onMinSizeChange(event.target.value)}
        />
      </div>

      {searchTerm.trim() ? (
        <div className="search-summary">
          Found <strong>{folderMatchCount}</strong> folder(s) and <strong>{fileMatchCount}</strong> file(s) matching "{searchTerm}"
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong></article>
}

function ScanProgressCard({ progress }: { progress: ScanProgress }) {
  const isHashing = progress.phase === 'hashing'
  return (
    <div className="progress-card">
      <div className="progress-row">
        <span>{isHashing ? 'Status' : 'Phase'}</span>
        <strong>{isHashing ? 'Hashing duplicates' : 'Scanning structure'}</strong>
      </div>
      {isHashing ? (
        <div className="progress-row">
          <span>Files hashed</span>
          <strong>{(progress.filesHashed || 0).toLocaleString()} / {(progress.totalToHash || 0).toLocaleString()}</strong>
        </div>
      ) : (
        <>
          <div className="progress-row"><span>Files</span><strong>{(progress.filesScanned || 0).toLocaleString()}</strong></div>
          <div className="progress-row"><span>Folders</span><strong>{(progress.foldersScanned || 0).toLocaleString()}</strong></div>
        </>
      )}
      <div className="progress-row"><span>Scanned</span><strong>{formatBytes(progress.bytesScanned || 0)}</strong></div>
      {progress.elapsedMs > 0 && (
        <div className="progress-row"><span>Elapsed</span><strong>{((progress.elapsedMs || 0) / 1000).toFixed(1)}s</strong></div>
      )}
      <p title={progress.currentPath}>{progress.currentPath}</p>
    </div>
  )
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={onClick}>{children}</button>
}

function FolderBrowser({
  childFolders,
  currentFiles,
  currentFolder,
  rootPath,
  onFolderOpen,
  onQueue,
  onTrashFolder,
  viewMode,
}: {
  childFolders: FolderSummary[]
  currentFiles: FileSummary[]
  currentFolder: string
  rootPath: string
  onFolderOpen: (path: string) => void
  onQueue: (file: FileSummary) => void
  onTrashFolder: (path: string, name: string) => void
  viewMode: ViewMode
}) {
  return (
    <div>
      <BreadcrumbNav currentFolder={currentFolder} rootPath={rootPath} onFolderOpen={onFolderOpen} />
      <h2>Folders ({childFolders.length})</h2>
      {childFolders.length > 0 ? (
        viewMode === 'list' ? (
          <FoldersTable folders={childFolders} onFolderOpen={onFolderOpen} onTrashFolder={onTrashFolder} />
        ) : (
          <FolderTiles folders={childFolders} onFolderOpen={onFolderOpen} onTrashFolder={onTrashFolder} />
        )
      ) : (
        <p className="note">No child folders found in this location.</p>
      )}
      <h2>Files in this folder ({currentFiles.length})</h2>
      <FilesView files={currentFiles} onQueue={onQueue} viewMode={viewMode} />
    </div>
  )
}

function BreadcrumbNav({
  currentFolder,
  rootPath,
  onFolderOpen,
}: {
  currentFolder: string
  rootPath: string
  onFolderOpen: (path: string) => void
}) {
  const segments = useMemo(() => buildBreadcrumbs(currentFolder, rootPath), [currentFolder, rootPath])

  return (
    <div className="breadcrumb-nav">
      <span className="breadcrumb-icon">📂</span>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <span key={segment.path} className="breadcrumb-item">
            {index > 0 && <span className="breadcrumb-separator">/</span>}
            {isLast ? (
              <strong className="breadcrumb-current" title={segment.path}>{segment.label}</strong>
            ) : segment.isClickable ? (
              <button className="breadcrumb-link" title={segment.path} onClick={() => onFolderOpen(segment.path)}>
                {segment.label}
              </button>
            ) : (
              <span className="breadcrumb-text" title={segment.path} onClick={() => window.spaceManager.openPath(segment.path)}>
                {segment.label}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

function buildBreadcrumbs(currentFolder: string, rootPath: string) {
  if (!currentFolder) return []
  const separator = currentFolder.includes('\\') ? '\\' : '/'
  const parts = currentFolder.split(separator).filter(Boolean)

  const segments: { label: string; path: string; isClickable: boolean }[] = []
  let cumulative = ''

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i === 0 && currentFolder.startsWith(part)) {
      cumulative = part + (currentFolder.includes(':\\') ? '\\' : '/')
    } else {
      cumulative = cumulative.endsWith(separator) ? cumulative + part : cumulative + separator + part
    }

    const normCumulative = cumulative.replace(/[\\/]+$/, '').toLowerCase()
    const normRoot = (rootPath || '').replace(/[\\/]+$/, '').toLowerCase()

    const isClickable = normCumulative === normRoot || normCumulative.startsWith(normRoot + '\\') || normCumulative.startsWith(normRoot + '/')

    segments.push({
      label: part,
      path: cumulative,
      isClickable,
    })
  }

  return segments
}

function FilesView({ files, onQueue, viewMode }: { files: FileSummary[]; onQueue: (file: FileSummary) => void; viewMode: ViewMode }) {
  if (!files || files.length === 0) return <p className="note">No files to show.</p>
  return viewMode === 'list' ? <FilesTable files={files} onQueue={onQueue} /> : <FileTiles files={files} onQueue={onQueue} />
}

type SortField = 'name' | 'size' | 'modifiedAt' | 'count' | 'extension'
type SortOrder = 'asc' | 'desc'

function FilesTable({ files, onQueue }: { files: FileSummary[]; onQueue: (file: FileSummary) => void }) {
  const [sortField, setSortField] = useState<SortField>('size')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const sortedFiles = useMemo(() => {
    return [...(files || [])].sort((a, b) => {
      let comparison = 0
      if (sortField === 'name') comparison = (a.name || '').localeCompare(b.name || '')
      else if (sortField === 'extension') comparison = (a.extension || '').localeCompare(b.extension || '')
      else if (sortField === 'size') comparison = (a.size || 0) - (b.size || 0)
      else if (sortField === 'modifiedAt') comparison = new Date(a.modifiedAt || 0).getTime() - new Date(b.modifiedAt || 0).getTime()
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [files, sortField, sortOrder])

  const toggleSelectAll = () => {
    if (selectedPaths.size === sortedFiles.length) {
      setSelectedPaths(new Set())
    } else {
      setSelectedPaths(new Set(sortedFiles.map((f) => f.path)))
    }
  }

  const toggleSelectOne = (filePath: string) => {
    const updated = new Set(selectedPaths)
    if (updated.has(filePath)) {
      updated.delete(filePath)
    } else {
      updated.add(filePath)
    }
    setSelectedPaths(updated)
  }

  const queueSelected = () => {
    const selectedFiles = sortedFiles.filter((f) => selectedPaths.has(f.path))
    selectedFiles.forEach((f) => onQueue(f))
    setSelectedPaths(new Set())
  }

  const selectedTotalSize = sortedFiles
    .filter((f) => selectedPaths.has(f.path))
    .reduce((sum, f) => sum + (f.size || 0), 0)

  const sortIndicator = (field: SortField) => sortField === field ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="table-wrap">
      {selectedPaths.size > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 14px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '0.9rem', color: '#166534' }}>
            Selected <strong>{selectedPaths.size}</strong> file(s) ({formatBytes(selectedTotalSize)})
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="small-button" onClick={() => setSelectedPaths(new Set())}>Deselect all</button>
            <button className="primary-button" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={queueSelected}>
              Queue selected ({selectedPaths.size})
            </button>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ width: '40px', textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={sortedFiles.length > 0 && selectedPaths.size === sortedFiles.length}
                onChange={toggleSelectAll}
                title="Select all"
              />
            </th>
            <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name{sortIndicator('name')}</th>
            <th onClick={() => toggleSort('extension')} style={{ cursor: 'pointer' }}>Type{sortIndicator('extension')}</th>
            <th onClick={() => toggleSort('size')} style={{ cursor: 'pointer' }}>Size{sortIndicator('size')}</th>
            <th onClick={() => toggleSort('modifiedAt')} style={{ cursor: 'pointer' }}>Modified{sortIndicator('modifiedAt')}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedFiles.map((file) => (
            <tr key={file.path} style={{ background: selectedPaths.has(file.path) ? '#f8fafc' : undefined }}>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={selectedPaths.has(file.path)}
                  onChange={() => toggleSelectOne(file.path)}
                />
              </td>
              <td title={file.path}>{fileIcon(file.extension)} {file.name}</td>
              <td>{file.extension}</td>
              <td>{formatBytes(file.size || 0)}</td>
              <td>{file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : '-'}</td>
              <td className="actions">
                <button onClick={() => window.spaceManager.openPath(file.path)}>Show</button>
                <button onClick={() => onQueue(file)}>Queue</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FileTiles({ files, onQueue }: { files: FileSummary[]; onQueue: (file: FileSummary) => void }) {
  return <div className="tile-grid">{(files || []).map((file) => <article className="tile" key={file.path} title={file.path}><div className="tile-icon">{fileIcon(file.extension)}</div><strong>{file.name}</strong><span>{formatBytes(file.size || 0)} · {file.extension}</span><div className="actions"><button onClick={() => window.spaceManager.openPath(file.path)}>Show</button><button onClick={() => onQueue(file)}>Queue</button></div></article>)}</div>
}

function TypesTable({ types }: { types: TypeSummary[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Type</th><th>Files</th><th>Total size</th></tr></thead><tbody>{(types || []).map((type) => <tr key={type.extension}><td>{fileIcon(type.extension)} {type.extension}</td><td>{(type.count || 0).toLocaleString()}</td><td>{formatBytes(type.size || 0)}</td></tr>)}</tbody></table></div>
}

function FoldersTable({ folders, onFolderOpen, onTrashFolder }: { folders: FolderSummary[]; onFolderOpen: (path: string) => void; onTrashFolder: (path: string, name: string) => void }) {
  const [sortField, setSortField] = useState<'name' | 'count' | 'size'>('size')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const toggleSort = (field: 'name' | 'count' | 'size') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const sortedFolders = useMemo(() => {
    return [...(folders || [])].sort((a, b) => {
      let comparison = 0
      if (sortField === 'name') comparison = (a.name || '').localeCompare(b.name || '')
      else if (sortField === 'count') comparison = (a.count || 0) - (b.count || 0)
      else if (sortField === 'size') comparison = (a.size || 0) - (b.size || 0)
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [folders, sortField, sortOrder])

  const sortIndicator = (field: 'name' | 'count' | 'size') => sortField === field ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Folder{sortIndicator('name')}</th>
            <th onClick={() => toggleSort('count')} style={{ cursor: 'pointer' }}>Files inside{sortIndicator('count')}</th>
            <th onClick={() => toggleSort('size')} style={{ cursor: 'pointer' }}>Total size{sortIndicator('size')}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedFolders.map((folder) => (
            <tr key={folder.path}>
              <td title={folder.path}>📁 {folder.name} {folder.count === 0 ? <span className="badge-empty">Empty</span> : null}</td>
              <td>{(folder.count || 0).toLocaleString()}</td>
              <td>{formatBytes(folder.size || 0)}</td>
              <td className="actions">
                <button onClick={() => onFolderOpen(folder.path)}>Open</button>
                <button onClick={() => window.spaceManager.openPath(folder.path)}>Show</button>
                <button className="danger" onClick={() => onTrashFolder(folder.path, folder.name)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FolderTiles({ folders, onFolderOpen, onTrashFolder }: { folders: FolderSummary[]; onFolderOpen: (path: string) => void; onTrashFolder: (path: string, name: string) => void }) {
  return (
    <div className="tile-grid folder-tiles">
      {(folders || []).map((folder) => (
        <div className="tile folder-tile" key={folder.path} title={folder.path}>
          <div className="tile-icon" onClick={() => onFolderOpen(folder.path)} style={{ cursor: 'pointer' }}>📁</div>
          <strong onClick={() => onFolderOpen(folder.path)} style={{ cursor: 'pointer' }}>
            {folder.name} {folder.count === 0 ? <span className="badge-empty">Empty</span> : null}
          </strong>
          <span>{formatBytes(folder.size || 0)} · {(folder.count || 0).toLocaleString()} files</span>
          <div className="actions">
            <button onClick={() => onFolderOpen(folder.path)}>Open</button>
            <button onClick={() => window.spaceManager.openPath(folder.path)}>Show</button>
            <button className="danger" onClick={() => onTrashFolder(folder.path, folder.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Duplicates({ groups, onQueue }: { groups: DuplicateGroup[]; onQueue: (file: FileSummary) => void }) {
  if (!groups || groups.length === 0) return <p className="note">No duplicate scan results yet. Click Find duplicates or run Full scan.</p>

  const totalReclaimable = groups.reduce((sum, g) => sum + (g.size || 0) * Math.max(0, (g.files || []).length - 1), 0)

  const queueAllExtras = () => {
    groups.forEach((group) => {
      // Keep the first copy, queue the rest (extras)
      const extras = (group.files || []).slice(1)
      extras.forEach((file) => onQueue(file))
    })
  }

  const queueGroupExtras = (group: DuplicateGroup) => {
    const extras = (group.files || []).slice(1)
    extras.forEach((file) => onQueue(file))
  }

  return (
    <div className="duplicate-container">
      <div className="queue-summary">
        <div>
          <strong>{groups.length} duplicate group(s)</strong>
          <span style={{ display: 'block', color: '#64748b', fontSize: '0.88rem' }}>
            Reclaimable space: {formatBytes(totalReclaimable)} (keeps 1 original copy per group)
          </span>
        </div>
        <button className="primary-button" onClick={queueAllExtras}>
          Queue all extra copies ({formatBytes(totalReclaimable)})
        </button>
      </div>

      <div className="duplicate-list">
        {groups.map((group) => {
          const groupReclaimable = (group.size || 0) * Math.max(0, (group.files || []).length - 1)
          return (
            <article className="duplicate-group" key={group.hash}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{(group.files || []).length} copies · {formatBytes(group.size || 0)} each</h3>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Reclaimable: {formatBytes(groupReclaimable)}</span>
                </div>
                <button className="small-button" onClick={() => queueGroupExtras(group)}>
                  Queue extra copies
                </button>
              </div>
              <FilesTable files={group.files || []} onQueue={onQueue} />
            </article>
          )
        })}
      </div>
    </div>
  )
}

function CleanupPanel({
  emptyFolders,
  queue,
  suggestions,
  onClearQueue,
  onMoveQueued,
  onQueue,
  onRemove,
  onTrashFolder,
}: {
  emptyFolders: FolderSummary[]
  queue: FileSummary[]
  suggestions: { title: string; files: FileSummary[]; totalSize: number }[]
  onClearQueue: () => void
  onMoveQueued: () => void
  onQueue: (file: FileSummary) => void
  onRemove: (path: string) => void
  onTrashFolder: (path: string, name: string) => void
}) {
  return (
    <div>
      <h2>Cleanup queue</h2>
      <p className="note">Files in this queue are not deleted yet. Final cleanup moves them to the Windows Recycle Bin.</p>
      <div className="queue-summary">
        <strong>{(queue || []).length} files · {formatBytes((queue || []).reduce((sum, file) => sum + (file.size || 0), 0))}</strong>
        <div className="actions">
          <button disabled={(queue || []).length === 0} onClick={onClearQueue}>Reset / Clear queue</button>
          <button className="primary-button" disabled={(queue || []).length === 0} onClick={onMoveQueued}>Move queue to Recycle Bin</button>
        </div>
      </div>
      {(queue || []).length > 0 ? <QueuedFiles files={queue} onRemove={onRemove} /> : null}

      <h2>Empty folders ({(emptyFolders || []).length})</h2>
      <p className="note">Folders with zero files inside. These can safely be deleted or reviewed.</p>
      {(!emptyFolders || emptyFolders.length === 0) ? <p className="note">No empty folders found.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folder</th><th>Path</th><th>Actions</th></tr></thead>
            <tbody>
              {emptyFolders.slice(0, 50).map((folder) => (
                <tr key={folder.path}>
                  <td>📁 {folder.name}</td>
                  <td title={folder.path}>{folder.path}</td>
                  <td className="actions">
                    <button onClick={() => window.spaceManager.openPath(folder.path)}>Show</button>
                    <button className="danger" onClick={() => onTrashFolder(folder.path, folder.name)}>Delete folder</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Cleanup suggestions</h2>
      <div className="suggestion-grid">{(suggestions || []).map((suggestion) => <article className="suggestion-card" key={suggestion.title}><h3>{suggestion.title}</h3><strong>{formatBytes(suggestion.totalSize || 0)}</strong><p>{(suggestion.files || []).length} files</p><button disabled={(suggestion.files || []).length === 0} onClick={() => suggestion.files.slice(0, 50).forEach(onQueue)}>Queue top files</button></article>)}</div>
    </div>
  )
}

function ErrorsPanel({ errors }: { errors: { path: string; message: string }[] }) {
  if (!errors || errors.length === 0) {
    return <p className="note">No permission errors or inaccessible folders encountered during scan.</p>
  }

  return (
    <div>
      <h2>Skipped / Inaccessible Paths ({errors.length})</h2>
      <p className="note">These folders or files could not be read during the scan (e.g. system permissions or locked files).</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Error details</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((error, idx) => (
              <tr key={idx}>
                <td title={error.path}>{error.path}</td>
                <td title={error.message}>{error.message}</td>
                <td className="actions">
                  <button onClick={() => window.spaceManager.openPath(error.path)}>Show in Explorer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function QueuedFiles({ files, onRemove }: { files: FileSummary[]; onRemove: (path: string) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Path</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(files || []).map((file) => (
            <tr key={file.path}>
              <td title={file.path}>{fileIcon(file.extension)} {file.name}</td>
              <td>{file.extension}</td>
              <td>{formatBytes(file.size || 0)}</td>
              <td title={file.path}>{file.path}</td>
              <td className="actions">
                <button onClick={() => window.spaceManager.openPath(file.path)}>Show</button>
                <button className="danger" onClick={() => onRemove(file.path)}>Remove from queue</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JobsPanel({ jobs, selectedLocations, onRemoveLocation, onUseResult }: { jobs: ScanJob[]; selectedLocations: string[]; onRemoveLocation: (path: string) => void; onUseResult: (result: ScanResult) => void }) {
  return (
    <div>
      <h2>Selected locations</h2>
      {(!selectedLocations || selectedLocations.length === 0) ? <p className="note">No locations selected.</p> : <div className="location-list">{selectedLocations.map((path) => <div className="location-row" key={path}><span title={path}>{path}</span><button onClick={() => onRemoveLocation(path)}>Remove</button></div>)}</div>}
      <h2>Scan jobs</h2>
      {(!jobs || jobs.length === 0) ? <p className="note">No scan jobs yet.</p> : <div className="job-list">{jobs.map((job) => <article className="job-card" key={job.id}><strong>{job.status.toUpperCase()}</strong><span title={job.path}>{job.path}</span>{job.result ? <button onClick={() => onUseResult(job.result!)}>Open result</button> : null}{job.error ? <p className="note">{job.error}</p> : null}</article>)}</div>}
    </div>
  )
}

function buildCleanupSuggestions(files: FileSummary[]) {
  const oldDate = Date.now() - 180 * 24 * 60 * 60 * 1000
  const groups = [
    { title: 'Large videos', files: (files || []).filter((file) => getCategory(file.extension) === 'video' && (file.size || 0) >= 250 * 1024 * 1024) },
    { title: 'Installers', files: (files || []).filter((file) => getCategory(file.extension) === 'installer') },
    { title: 'Archives', files: (files || []).filter((file) => getCategory(file.extension) === 'archive') },
    { title: 'Old large files', files: (files || []).filter((file) => (file.size || 0) >= 100 * 1024 * 1024 && new Date(file.modifiedAt).getTime() < oldDate) },
  ]

  return groups.map((group) => ({ ...group, files: group.files.sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 100), totalSize: group.files.reduce((sum, file) => sum + (file.size || 0), 0) }))
}

function applyFileFilters(files: FileSummary[], searchTerm: string, categoryFilter: string, minSizeMb: string) {
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const minBytes = Number(minSizeMb || 0) * 1024 * 1024
  return (files || []).filter((file) => {
    const matchesSearch = !normalizedSearch || (file.name || '').toLowerCase().includes(normalizedSearch) || (file.path || '').toLowerCase().includes(normalizedSearch)
    const matchesCategory = categoryFilter === 'all' || getCategory(file.extension) === categoryFilter
    const matchesSize = !minBytes || (file.size || 0) >= minBytes
    return matchesSearch && matchesCategory && matchesSize
  })
}

function getCategory(extension: string) {
  const ext = (extension || '').toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image'
  if (['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(ext)) return 'video'
  if (['.mp3', '.wav', '.m4a', '.flac'].includes(ext)) return 'audio'
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'archive'
  if (['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx', '.xls', '.xlsx'].includes(ext)) return 'document'
  if (ext === '.exe' || ext === '.msi') return 'installer'
  return 'other'
}

function fileIcon(extension: string) {
  const category = getCategory(extension)
  if (category === 'image') return '🖼️'
  if (category === 'video') return '🎞️'
  if (category === 'audio') return '🎵'
  if (category === 'archive') return '🗜️'
  if (category === 'document') return '📄'
  if (category === 'installer') return '⚙️'
  return '📦'
}

function unique(items: string[]) {
  return [...new Set(items)]
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export default App
