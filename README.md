# Laptop Space Manager

A Windows desktop app for understanding what is filling your laptop storage.

This version includes:

- **Per-Item Queue Removal & Reset**: Each queued file in the Cleanup tab has a **"Remove from queue"** button, plus a **"Reset / Clear queue"** button to instantly clear the entire queue at once.
- **Interactive Path Breadcrumbs**: Replaced the "Up" button with clickable path segments (`📂 Projects / laptop-space-manager / src / assets`). Clicking any parent folder segment directly opens that folder in the app!
- **Folder "Show" Action**: Added a **Show** button to folders in table and tile views to reveal/open the folder directly in Windows File Explorer.
- **Common Search Across Folders & Files**: The main search bar searches both subfolder names AND file names live inside the folder browser, with a real-time matching count banner (`Found X folder(s) and Y file(s) matching "..."`).
- **Instant Delete List Refresh**: Deleting a file or folder immediately updates and refreshes the scan result state in real time without needing a full manual re-scan.
- **Full Scan Mode**: Added **`🔥 Full scan`** button alongside **`⚡ Fast scan`**. Full scan computes file sizes, empty folders, AND runs duplicate content-hashing in one single sequence.
- **Streamlined Selection Workflow**: Choose one or multiple folders via a single clean `"Select folder(s)"` interface.
- Folder-first browser with **Delete Folder** action (moves to Windows Recycle Bin)
- Empty folder detection with an **Empty Badge** and one-click cleanup
- Skipped / Error path reporting for permission-restricted folders
- Switch between list view and tile view
- Real-time scan progress display and **Cancel Scan** button
- Multi-location scan job queue
- Search and filter file results by name, type category, and minimum size
- Guided cleanup suggestions (large videos, old large files, installers, archives)
- Safe Cleanup Queue with confirmation before moving files to the Windows Recycle Bin

## Tech stack

- React
- TypeScript
- Vite
- Electron

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
- Deleting files or folders moves them to the Windows Recycle Bin for safety.
- Duplicate detection compares file content hashes and runs separately on demand or during Full Scan.

## Project documentation

See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the product plan, safety principles, performance direction, and future roadmap.
