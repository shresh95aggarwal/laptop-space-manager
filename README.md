# Laptop Space Manager

A hardened, zero-data-loss Windows desktop disk space manager designed to inspect storage, detect duplicates, and safely reclaim space.

Built with **React**, **TypeScript**, **Vite**, and **Electron**.

---

## Key Features

### 🛡️ Safety & Zero-Data-Loss Core
- **Recycle Bin Exclusivity**: Deletions strictly route through Windows Recycle Bin (`shell.trashItem`). No destructive `fs.rm()` fallbacks are ever used; targets are preserved intact if trashing fails.
- **Dual-Layer System Guard**: Both Electron main process and React UI protect Windows system roots (`C:\Windows`, `Program Files`, `ProgramData`, and root drives like `C:\`, `D:\`) against accidental deletion.
- **Junction & Symlink Traversal Protection**: Directory traversal automatically skips symlinks and junction points to prevent infinite recursive scan loops.

### 📊 Storage Analytics & True Proportional Treemap
- **Proportional Area Treemap**: A binary squarified slice-and-dice layout where block areas strictly represent actual byte consumption. Click any folder block to drill down directly.
- **Drive Overview Dashboard**: Displays active drive capacity, used bytes, and free storage bar via native filesystem metrics.
- **Sortable File & Folder Tables**: Interactive sort headers (Name, Type, Size, File Count, Modified Date) with direction indicators.
- **Multi-Select Bulk Queueing**: Row checkboxes with select-all, floating summary bar (`Selected X files, Y MB`), and one-click bulk queueing.

### 🕒 Persistent History & Historical Scan Comparisons
- **Timestamped Snapshots**: Automatically stores up to 10 historical scans with unique snapshot UUIDs and timestamps in persistent storage.
- **Visual Scan Comparison (`Compare Scans`)**: Select any two past scans (baseline vs. target) to evaluate:
  - Net space change (`+Grown` or `-Freed` with percentage change)
  - Net file count change
  - Root directory mismatch warnings when comparing distinct folders
  - Safe handling of legacy snapshots and corrupted data

### 🔍 Memory-Safe Streaming Duplicate Detection
- **Chunked SHA-256 Hashing**: Streams files chunk-by-chunk to prevent high RAM consumption on multi-gigabyte files.
- **Duplicate Cleanup Controls**: Total reclaimable space calculator and one-click extra-copy queueing (guarantees 1 original copy remains safe).
- **End-to-End Cancellation**: Halts traversal and hashing immediately when cancelled without swallowing errors in nested calls.

### 📁 Comprehensive CSV & JSON Reports
- **Full & Top CSV Exports**: Export all scanned files without limits or export the top largest files. Built with RFC-4180 escaping for commas, quotes, and newlines.
- **Full & Summary JSON Exports**: Exports either full file trees or concise summary reports (totals, top folders, top files).
- **Reliable Download Lifecycle**: Appends download links and defers `URL.revokeObjectURL()` to allow the Electron/Chromium download manager to complete file streams reliably.

### 🖼️ Secure Image Tile Previews
- **Scoped `atom://` Protocol**: Custom file protocol serving local thumbnails for image formats (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.svg`).
- **Filesystem Security**: Restricts access to permitted scan directories, blocks path traversal (`..`), and rejects protected Windows system directories.
- **Resilient Fallback**: Image load failures cleanly switch to file type icons rather than broken boxes.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Desktop Harness**: Electron, Node.js IPC
- **Build & Packaging**: `electron-builder` (NSIS Windows Installer)
- **Testing**: Built-in `node --test` suite

---

## Getting Started

### Development
```powershell
cd laptop-space-manager
npm install
npm run dev
```

If Node.js and Git are not in your path:
```powershell
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
```

### Run Tests
```powershell
npm test
```
Runs the 13 automated unit and integration tests covering trashing safety, streaming duplicates, scan cancellation, empty folders, system protection, symlinks, CSV/JSON serialization, snapshot comparison, treemap layout, and image security.

### Build Production Bundle
```powershell
npm run build
```

### Build Windows Installer (.exe)
```powershell
npm run dist
```
Uses `electron-builder` to bundle the app and build a standalone NSIS Windows installer.

---

## Documentation

- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md): Architecture, safety guarantees, performance guidelines, and product roadmap.
