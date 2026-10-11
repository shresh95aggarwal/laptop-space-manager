# Laptop Space Manager

A Windows desktop app for understanding what is filling your laptop storage.

This first version is intentionally safe and simple:

- Choose a folder to scan
- See total scanned size and file count
- Browse folders by size
- Switch between list view and tile view
- See scan progress while the scan is running
- Cancel a running fast scan
- Choose multiple scan locations
- Track scan jobs
- Search and filter file results
- Use cleanup suggestions
- Queue files before moving them to the Recycle Bin
- Sort/review largest files
- See file types by total size
- See largest folders
- Detect duplicate files by content hash as a separate slower action
- Open a file in Windows Explorer
- Move selected files to the Recycle Bin instead of permanently deleting them

## Tech stack

- React
- TypeScript
- Vite
- Electron

Electron is used because normal browser apps cannot scan or delete local files freely. A future version can migrate to Tauri after Rust is installed.

## Run locally

```powershell
cd C:\Users\shresh\Projects\laptop-space-manager
npm install
npm run dev
```

If `npm` is not found, add Node.js and Git to the current terminal PATH:

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path
```

## Build check

```powershell
npm run build
```

## Safe usage tips

- Start by scanning personal folders like Downloads, Desktop, Documents, Pictures, or Videos.
- Avoid scanning/deleting Windows system folders until the app has stronger safety checks.
- Deleting uses the Windows Recycle Bin, but you should still review each file before deleting.
- Duplicate detection compares file content hashes, not just names.

## Future ideas

- Treemap visualization
- Filters for file size, age, type, and folder
- Better duplicate cleanup workflow
- Scan history
- Local full-disk index using SQLite
- Packaged Windows installer
- Tauri version for a smaller app

## Project documentation

See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the product plan, safety principles, performance direction, and future roadmap.
