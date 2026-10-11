import { useEffect, useMemo, useState } from 'react'

type Tab = 'browse' | 'files' | 'types' | 'duplicates' | 'cleanup' | 'jobs' | 'errors'
type ViewMode = 'list' | 'tiles'
type ScanJob = {
  id: string
  path: string
  status: 'waiting' | 'running' | 'complete' | 'cancelled' | 'failed'
  result?: ScanResult
  error?: string
}

function App() {
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
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
  const [message, setMessage] = useState('Choose a folder to scan. Start with Downloads or another safe personal folder.')

  useEffect(() => {
    window.spaceManager.getCommonLocations().then(setCommonLocations).catch(() => setCommonLocations([]))
    return window.spaceManager.onScanProgress(setScanProgress)
  }, [])

  const currentFolderInfo = useMemo(
    () => result?.largestFolders.find((folder) => folder.path === currentFolder),
    [currentFolder, result],
  )

  const childFolders = useMemo(() => {
    if (!result || !currentFolder) return []
    return result.largestFolders
      .filter((folder) => folder.parentPath === currentFolder)
      .sort((a, b) => b.size - a.size)
  }, [currentFolder, result])

  const currentFiles = useMemo(() => {
    if (!result || !currentFolder) return []
    return applyFileFilters(result.files.filter((file) => file.folder === currentFolder), searchTerm, categoryFilter, minSizeMb)
      .sort((a, b) => b.size - a.size)
      .slice(0, 250)
  }, [categoryFilter, currentFolder, minSizeMb, result, searchTerm])

  const filteredLargestFiles = useMemo(() => {
    if (!result) return []
    return applyFileFilters(result.largestFiles, searchTerm, categoryFilter, minSizeMb)
  }, [categoryFilter, minSizeMb, result, searchTerm])

  const cleanupSuggestions = useMemo(() => {
    if (!result) return []
    return buildCleanupSuggestions(result.files, result.emptyFolders)
  }, [result])

  const duplicateFiles = useMemo(
    () => result?.duplicateGroups.flatMap((group) => group.files.slice(1)) ?? [],
    [result],
  )

  async function chooseFolder() {
    const folder = await window.spaceManager.pickFolder()
    if (folder) {
      setSelectedFolder(folder)
      setSelectedLocations([folder])
      setCurrentFolder(folder)
      setResult(null)
      setActiveTab('browse')
      setMessage('Folder selected. Click Fast scan to analyze folder sizes and file types.')
    }
  }

  async function chooseFolders() {
    const folders = await window.spaceManager.pickFolders()
    if (folders.length > 0) {
      setSelectedLocations(unique([...selectedLocations, ...folders]))
      setSelectedFolder(folders[0])
      setMessage(`${folders.length} folder(s) added to scan locations.`)
      setActiveTab('jobs')
    }
  }

  function addCommonLocation(path: string) {
    setSelectedLocations(unique([...selectedLocations, path]))
    setSelectedFolder(path)
    setActiveTab('jobs')
    setMessage('Common location added to scan locations.')
  }

  async function scanFolder(folder = selectedFolder) {
    if (!folder) return null

    setIsScanning(true)
    setScanProgress(null)
    setMessage('Fast scanning file sizes and folders. Duplicate hashing is skipped for speed...')

    try {
      const scanResult = await window.spaceManager.scanFolder(folder)
      setResult(scanResult)
      setSelectedFolder(folder)
      setCurrentFolder(scanResult.rootPath)
      setActiveTab('browse')
      setMessage(`Fast scan complete in ${(scanResult.durationMs / 1000).toFixed(1)} seconds.`)
      return scanResult
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Scan failed.')
      throw error
    } finally {
      setIsScanning(false)
      setScanProgress(null)
    }
  }

  async function scanSelectedLocations() {
    if (selectedLocations.length === 0) return

    const jobs: ScanJob[] = selectedLocations.map((path) => ({ id: crypto.randomUUID(), path, status: 'waiting' }))
    setScanJobs(jobs)
    setActiveTab('jobs')

    for (const job of jobs) {
      setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status: 'running' } : item))
      try {
        const scanResult = await scanFolder(job.path)
        setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status: 'complete', result: scanResult ?? undefined } : item))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Scan failed.'
        const status = errorMessage.toLowerCase().includes('cancelled') ? 'cancelled' : 'failed'
        setScanJobs((existing) => existing.map((item) => item.id === job.id ? { ...item, status, error: errorMessage } : item))
        if (status === 'cancelled') break
      }
    }
  }

  async function cancelScan() {
    await window.spaceManager.cancelScan()
    setMessage('Cancelling scan...')
  }

  async function findDuplicates() {
    if (!selectedFolder || !result) return

    setIsFindingDuplicates(true)
    setMessage('Finding duplicates. This is slower because file contents must be checked...')

    try {
      const duplicateResult = await window.spaceManager.findDuplicates(selectedFolder)
      setResult({
        ...result,
        duplicateGroups: duplicateResult.duplicateGroups,
        totals: {
          ...result.totals,
          duplicateGroups: duplicateResult.duplicateGroups.length,
          duplicateBytes: duplicateResult.duplicateBytes,
        },
      })
      setActiveTab('duplicates')
      setMessage(`Duplicate scan complete. Found ${duplicateResult.duplicateGroups.length} duplicate groups.`)
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
  }

  async function moveQueuedFilesToTrash() {
    if (cleanupQueue.length === 0) return
    const totalSize = cleanupQueue.reduce((sum, file) => sum + file.size, 0)
    const confirmed = window.confirm(`Move ${cleanupQueue.length} file(s), ${formatBytes(totalSize)}, to the Recycle Bin?`)
    if (!confirmed) return

    for (const file of cleanupQueue) {
      await window.spaceManager.moveToTrash(file.path)
    }

    setCleanupQueue([])
    setMessage('Cleanup queue moved to the Recycle Bin. Run Fast scan again to refresh results.')
  }

  async function trashFolder(folderPath: string, folderName: string) {
    const confirmed = window.confirm(`Move folder "${folderName}" and all its contents to the Recycle Bin?\n\n${folderPath}`)
    if (!confirmed) return

    await window.spaceManager.moveToTrash(folderPath)
    setMessage(`Folder "${folderName}" moved to the Recycle Bin. Run Fast scan again to refresh results.`)
  }

  function goUp() {
    if (!result || !currentFolder || currentFolder === result.rootPath) return
    const parent = currentFolderInfo?.parentPath
    if (parent) setCurrentFolder(parent)
  }

  return (
    <main className="app-shell">
      <section className="hero compact">
        <div>
          <p className="eyebrow">Laptop Space Manager</p>
          <h1>Manage storage folder by folder.</h1>
          <p className="intro">Fast scans, scan jobs, filters, cleanup suggestions, and a safe Recycle Bin queue.</p>
        </div>
        <div className="scan-card">
          <button onClick={chooseFolder}>Choose one folder</button>
          <button onClick={chooseFolders}>Choose multiple folders</button>
          <button disabled={!selectedFolder || isScanning} onClick={() => scanFolder()}>{isScanning ? 'Scanning...' : 'Fast scan active folder'}</button>
          <button disabled={selectedLocations.length === 0 || isScanning} onClick={scanSelectedLocations}>Scan selected locations</button>
          {isScanning ? <button className="danger-button" onClick={cancelScan}>Cancel scan</button> : null}
          <button disabled={!result || isFindingDuplicates} onClick={findDuplicates}>{isFindingDuplicates ? 'Checking...' : 'Find duplicates'}</button>
          <p className="folder-path">{selectedFolder || 'No active folder selected yet'}</p>
          <p className="message">{message}</p>
          {scanProgress ? <ScanProgressCard progress={scanProgress} /> : null}
        </div>
      </section>

      <section className="quick-locations">
        <strong>Quick add:</strong>
        {commonLocations.map((location) => (
          <button key={location.path} onClick={() => addCommonLocation(location.path)}>{location.label}</button>
        ))}
      </section>

      {result ? (
        <>
          <section className="stats-grid">
            <Stat label="Scanned size" value={formatBytes(result.totals.size)} />
            <Stat label="Files found" value={result.totals.files.toLocaleString()} />
            <Stat label="Empty folders" value={result.totals.emptyFolders.toLocaleString()} />
            <Stat label="Errors / Skipped" value={result.totals.errors.toLocaleString()} />
          </section>

          <section className="panel">
            <div className="toolbar">
              <div className="tabs">
                <TabButton active={activeTab === 'browse'} onClick={() => setActiveTab('browse')}>Folder browser</TabButton>
                <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')}>Largest files</TabButton>
                <TabButton active={activeTab === 'types'} onClick={() => setActiveTab('types')}>File types</TabButton>
                <TabButton active={activeTab === 'duplicates'} onClick={() => setActiveTab('duplicates')}>Duplicates ({duplicateFiles.length})</TabButton>
                <TabButton active={activeTab === 'cleanup'} onClick={() => setActiveTab('cleanup')}>Cleanup ({cleanupQueue.length})</TabButton>
                <TabButton active={activeTab === 'errors'} onClick={() => setActiveTab('errors')}>Errors / Skipped ({result.errors.length})</TabButton>
                <TabButton active={activeTab === 'jobs'} onClick={() => setActiveTab('jobs')}>Jobs ({scanJobs.length})</TabButton>
              </div>
              <div className="view-toggle" aria-label="View mode">
                <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
                <button className={viewMode === 'tiles' ? 'active' : ''} onClick={() => setViewMode('tiles')}>Tiles</button>
              </div>
            </div>

            {(activeTab === 'browse' || activeTab === 'files') ? (
              <Filters searchTerm={searchTerm} categoryFilter={categoryFilter} minSizeMb={minSizeMb} onCategoryChange={setCategoryFilter} onMinSizeChange={setMinSizeMb} onSearchChange={setSearchTerm} />
            ) : null}

            {activeTab === 'browse' && (
              <FolderBrowser childFolders={childFolders} currentFiles={currentFiles} currentFolder={currentFolder} isRoot={currentFolder === result.rootPath} onFolderOpen={setCurrentFolder} onGoUp={goUp} onQueue={addToCleanupQueue} onTrashFolder={trashFolder} viewMode={viewMode} />
            )}
            {activeTab === 'files' && <FilesView files={filteredLargestFiles} onQueue={addToCleanupQueue} viewMode={viewMode} />}
            {activeTab === 'types' && <TypesTable types={result.fileTypes} />}
            {activeTab === 'duplicates' && <Duplicates groups={result.duplicateGroups} onQueue={addToCleanupQueue} />}
            {activeTab === 'cleanup' && <CleanupPanel emptyFolders={result.emptyFolders} queue={cleanupQueue} suggestions={cleanupSuggestions} onMoveQueued={moveQueuedFilesToTrash} onQueue={addToCleanupQueue} onRemove={removeFromCleanupQueue} onTrashFolder={trashFolder} />}
            {activeTab === 'errors' && <ErrorsPanel errors={result.errors} />}
            {activeTab === 'jobs' && <JobsPanel jobs={scanJobs} selectedLocations={selectedLocations} onRemoveLocation={(path) => setSelectedLocations((items) => items.filter((item) => item !== path))} onUseResult={(scanResult) => { setResult(scanResult); setSelectedFolder(scanResult.rootPath); setCurrentFolder(scanResult.rootPath); setActiveTab('browse') }} />}
          </section>
        </>
      ) : (
        <section className="empty-state">
          <h2>Recommended workflow</h2>
          <p>Choose one or more personal folders, run a fast scan, then use filters and cleanup suggestions.</p>
          <p>Duplicate checking is separate because it is naturally slower.</p>
          {selectedLocations.length > 0 ? <JobsPanel jobs={scanJobs} selectedLocations={selectedLocations} onRemoveLocation={(path) => setSelectedLocations((items) => items.filter((item) => item !== path))} onUseResult={() => undefined} /> : null}
        </section>
      )}
    </main>
  )
}

function Filters({ searchTerm, categoryFilter, minSizeMb, onSearchChange, onCategoryChange, onMinSizeChange }: { searchTerm: string; categoryFilter: string; minSizeMb: string; onSearchChange: (value: string) => void; onCategoryChange: (value: string) => void; onMinSizeChange: (value: string) => void }) {
  return (
    <div className="filters">
      <input placeholder="Search files..." value={searchTerm} onChange={(event) => onSearchChange(event.target.value)} />
      <select value={categoryFilter} onChange={(event) => onCategoryChange(event.target.value)}>
        <option value="all">All types</option>
        <option value="image">Images</option>
        <option value="video">Videos</option>
        <option value="audio">Audio</option>
        <option value="archive">Archives</option>
        <option value="document">Documents</option>
        <option value="installer">Installers</option>
      </select>
      <input min="0" placeholder="Min size MB" type="number" value={minSizeMb} onChange={(event) => onMinSizeChange(event.target.value)} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong></article>
}

function ScanProgressCard({ progress }: { progress: ScanProgress }) {
  return (
    <div className="progress-card">
      <div className="progress-row"><span>Files</span><strong>{progress.filesScanned.toLocaleString()}</strong></div>
      <div className="progress-row"><span>Folders</span><strong>{progress.foldersScanned.toLocaleString()}</strong></div>
      <div className="progress-row"><span>Scanned</span><strong>{formatBytes(progress.bytesScanned)}</strong></div>
      <div className="progress-row"><span>Elapsed</span><strong>{(progress.elapsedMs / 1000).toFixed(1)}s</strong></div>
      <p title={progress.currentPath}>{progress.currentPath}</p>
    </div>
  )
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={onClick}>{children}</button>
}

function FolderBrowser({ childFolders, currentFiles, currentFolder, isRoot, onFolderOpen, onGoUp, onQueue, onTrashFolder, viewMode }: { childFolders: FolderSummary[]; currentFiles: FileSummary[]; currentFolder: string; isRoot: boolean; onFolderOpen: (path: string) => void; onGoUp: () => void; onQueue: (file: FileSummary) => void; onTrashFolder: (path: string, name: string) => void; viewMode: ViewMode }) {
  return (
    <div>
      <div className="breadcrumb"><button disabled={isRoot} onClick={onGoUp}>Up</button><span title={currentFolder}>{currentFolder}</span></div>
      <h2>Folders</h2>
      {childFolders.length > 0 ? viewMode === 'list' ? <FoldersTable folders={childFolders} onFolderOpen={onFolderOpen} onTrashFolder={onTrashFolder} /> : <FolderTiles folders={childFolders} onFolderOpen={onFolderOpen} onTrashFolder={onTrashFolder} /> : <p className="note">No child folders here.</p>}
      <h2>Largest files in this folder</h2>
      <FilesView files={currentFiles} onQueue={onQueue} viewMode={viewMode} />
    </div>
  )
}

function FilesView({ files, onQueue, viewMode }: { files: FileSummary[]; onQueue: (file: FileSummary) => void; viewMode: ViewMode }) {
  if (files.length === 0) return <p className="note">No files to show.</p>
  return viewMode === 'list' ? <FilesTable files={files} onQueue={onQueue} /> : <FileTiles files={files} onQueue={onQueue} />
}

function FilesTable({ files, onQueue }: { files: FileSummary[]; onQueue: (file: FileSummary) => void }) {
  return (
    <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead><tbody>
      {files.map((file) => <tr key={file.path}><td title={file.path}>{fileIcon(file.extension)} {file.name}</td><td>{file.extension}</td><td>{formatBytes(file.size)}</td><td>{new Date(file.modifiedAt).toLocaleDateString()}</td><td className="actions"><button onClick={() => window.spaceManager.openPath(file.path)}>Show</button><button onClick={() => onQueue(file)}>Queue</button></td></tr>)}
    </tbody></table></div>
  )
}

function FileTiles({ files, onQueue }: { files: FileSummary[]; onQueue: (file: FileSummary) => void }) {
  return <div className="tile-grid">{files.map((file) => <article className="tile" key={file.path} title={file.path}><div className="tile-icon">{fileIcon(file.extension)}</div><strong>{file.name}</strong><span>{formatBytes(file.size)} · {file.extension}</span><div className="actions"><button onClick={() => window.spaceManager.openPath(file.path)}>Show</button><button onClick={() => onQueue(file)}>Queue</button></div></article>)}</div>
}

function TypesTable({ types }: { types: TypeSummary[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Type</th><th>Files</th><th>Total size</th></tr></thead><tbody>{types.map((type) => <tr key={type.extension}><td>{fileIcon(type.extension)} {type.extension}</td><td>{type.count.toLocaleString()}</td><td>{formatBytes(type.size)}</td></tr>)}</tbody></table></div>
}

function FoldersTable({ folders, onFolderOpen, onTrashFolder }: { folders: FolderSummary[]; onFolderOpen: (path: string) => void; onTrashFolder: (path: string, name: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Folder</th><th>Files inside</th><th>Total size</th><th>Actions</th></tr></thead><tbody>{folders.map((folder) => <tr key={folder.path}><td title={folder.path}>📁 {folder.name} {folder.count === 0 ? <span className="badge-empty">Empty</span> : null}</td><td>{folder.count.toLocaleString()}</td><td>{formatBytes(folder.size)}</td><td className="actions"><button onClick={() => onFolderOpen(folder.path)}>Open</button><button className="danger" onClick={() => onTrashFolder(folder.path, folder.name)}>Delete</button></td></tr>)}</tbody></table></div>
}

function FolderTiles({ folders, onFolderOpen, onTrashFolder }: { folders: FolderSummary[]; onFolderOpen: (path: string) => void; onTrashFolder: (path: string, name: string) => void }) {
  return <div className="tile-grid folder-tiles">{folders.map((folder) => <div className="tile folder-tile" key={folder.path} title={folder.path}><div className="tile-icon" onClick={() => onFolderOpen(folder.path)} style={{ cursor: 'pointer' }}>📁</div><strong onClick={() => onFolderOpen(folder.path)} style={{ cursor: 'pointer' }}>{folder.name} {folder.count === 0 ? <span className="badge-empty">Empty</span> : null}</strong><span>{formatBytes(folder.size)} · {folder.count.toLocaleString()} files</span><div className="actions"><button onClick={() => onFolderOpen(folder.path)}>Open</button><button className="danger" onClick={() => onTrashFolder(folder.path, folder.name)}>Delete</button></div></div>)}</div>
}

function Duplicates({ groups, onQueue }: { groups: DuplicateGroup[]; onQueue: (file: FileSummary) => void }) {
  if (groups.length === 0) return <p className="note">No duplicate scan results yet. Click Find duplicates after a Fast scan.</p>
  return <div className="duplicate-list">{groups.map((group) => <article className="duplicate-group" key={group.hash}><h3>{group.files.length} copies · {formatBytes(group.size)} each</h3><p className="note">Suggestion: keep one copy and queue extras only after checking them.</p><FilesTable files={group.files} onQueue={onQueue} /></article>)}</div>
}

function CleanupPanel({ emptyFolders, queue, suggestions, onMoveQueued, onQueue, onRemove, onTrashFolder }: { emptyFolders: FolderSummary[]; queue: FileSummary[]; suggestions: { title: string; files: FileSummary[]; totalSize: number }[]; onMoveQueued: () => void; onQueue: (file: FileSummary) => void; onRemove: (path: string) => void; onTrashFolder: (path: string, name: string) => void }) {
  return (
    <div>
      <h2>Cleanup queue</h2>
      <p className="note">Files in this queue are not deleted yet. Final cleanup moves them to the Windows Recycle Bin.</p>
      <div className="queue-summary"><strong>{queue.length} files · {formatBytes(queue.reduce((sum, file) => sum + file.size, 0))}</strong><button disabled={queue.length === 0} onClick={onMoveQueued}>Move queue to Recycle Bin</button></div>
      {queue.length > 0 ? <QueuedFiles files={queue} onRemove={onRemove} /> : null}

      <h2>Empty folders ({emptyFolders.length})</h2>
      <p className="note">Folders with zero files inside. These can safely be deleted or reviewed.</p>
      {emptyFolders.length === 0 ? <p className="note">No empty folders found.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folder</th><th>Path</th><th>Action</th></tr></thead>
            <tbody>
              {emptyFolders.slice(0, 50).map((folder) => (
                <tr key={folder.path}>
                  <td>📁 {folder.name}</td>
                  <td title={folder.path}>{folder.path}</td>
                  <td className="actions">
                    <button className="danger" onClick={() => onTrashFolder(folder.path, folder.name)}>Delete folder</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Cleanup suggestions</h2>
      <div className="suggestion-grid">{suggestions.map((suggestion) => <article className="suggestion-card" key={suggestion.title}><h3>{suggestion.title}</h3><strong>{formatBytes(suggestion.totalSize)}</strong><p>{suggestion.files.length} files</p><button disabled={suggestion.files.length === 0} onClick={() => suggestion.files.slice(0, 50).forEach(onQueue)}>Queue top files</button></article>)}</div>
    </div>
  )
}

function ErrorsPanel({ errors }: { errors: { path: string; message: string }[] }) {
  if (errors.length === 0) {
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
  return <div className="table-wrap"><table><thead><tr><th>Name</th><th>Size</th><th>Action</th></tr></thead><tbody>{files.map((file) => <tr key={file.path}><td title={file.path}>{fileIcon(file.extension)} {file.name}</td><td>{formatBytes(file.size)}</td><td className="actions"><button onClick={() => window.spaceManager.openPath(file.path)}>Show</button><button className="danger" onClick={() => onRemove(file.path)}>Remove</button></td></tr>)}</tbody></table></div>
}

function JobsPanel({ jobs, selectedLocations, onRemoveLocation, onUseResult }: { jobs: ScanJob[]; selectedLocations: string[]; onRemoveLocation: (path: string) => void; onUseResult: (result: ScanResult) => void }) {
  return (
    <div>
      <h2>Selected locations</h2>
      {selectedLocations.length === 0 ? <p className="note">No locations selected.</p> : <div className="location-list">{selectedLocations.map((path) => <div className="location-row" key={path}><span title={path}>{path}</span><button onClick={() => onRemoveLocation(path)}>Remove</button></div>)}</div>}
      <h2>Scan jobs</h2>
      {jobs.length === 0 ? <p className="note">No scan jobs yet.</p> : <div className="job-list">{jobs.map((job) => <article className="job-card" key={job.id}><strong>{job.status.toUpperCase()}</strong><span title={job.path}>{job.path}</span>{job.result ? <button onClick={() => onUseResult(job.result!)}>Open result</button> : null}{job.error ? <p className="note">{job.error}</p> : null}</article>)}</div>}
    </div>
  )
}

function buildCleanupSuggestions(files: FileSummary[], _emptyFolders: FolderSummary[]) {
  const oldDate = Date.now() - 180 * 24 * 60 * 60 * 1000
  const groups = [
    { title: 'Large videos', files: files.filter((file) => getCategory(file.extension) === 'video' && file.size >= 250 * 1024 * 1024) },
    { title: 'Installers', files: files.filter((file) => getCategory(file.extension) === 'installer') },
    { title: 'Archives', files: files.filter((file) => getCategory(file.extension) === 'archive') },
    { title: 'Old large files', files: files.filter((file) => file.size >= 100 * 1024 * 1024 && new Date(file.modifiedAt).getTime() < oldDate) },
  ]

  return groups.map((group) => ({ ...group, files: group.files.sort((a, b) => b.size - a.size).slice(0, 100), totalSize: group.files.reduce((sum, file) => sum + file.size, 0) }))
}

function applyFileFilters(files: FileSummary[], searchTerm: string, categoryFilter: string, minSizeMb: string) {
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const minBytes = Number(minSizeMb || 0) * 1024 * 1024
  return files.filter((file) => {
    const matchesSearch = !normalizedSearch || file.name.toLowerCase().includes(normalizedSearch) || file.path.toLowerCase().includes(normalizedSearch)
    const matchesCategory = categoryFilter === 'all' || getCategory(file.extension) === categoryFilter
    const matchesSize = !minBytes || file.size >= minBytes
    return matchesSearch && matchesCategory && matchesSize
  })
}

function getCategory(extension: string) {
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(extension)) return 'image'
  if (['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(extension)) return 'video'
  if (['.mp3', '.wav', '.m4a', '.flac'].includes(extension)) return 'audio'
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(extension)) return 'archive'
  if (['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx', '.xls', '.xlsx'].includes(extension)) return 'document'
  if (extension === '.exe' || extension === '.msi') return 'installer'
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
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export default App
