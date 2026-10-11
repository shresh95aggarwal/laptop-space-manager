# Laptop Space Manager — Project Plan

This document explains what we are building, why we are building it, and how the app should evolve. It is meant to stay in the repository so the project is easy to understand when pushed to GitHub.

## Problem

Laptop storage fills up over time, and files are distributed across many folders with no clear structure. It becomes difficult to know:

- Which folders are using the most storage
- Which files are very large
- Which file types are taking space
- Which files are duplicates
- Which folders are empty
- Which files are safe to delete

## Product goal

Build a simple Windows desktop app that helps users understand and clean laptop storage safely.

The app should be visual, practical, and safe by default.

## Current technology

- React for the user interface
- TypeScript for safer code
- Vite for development/build tooling
- Electron for desktop file-system access

## Current features

- **Queue Management**: "Remove from queue" button for individual files and a "Reset / Clear queue" button to reset the entire list
- **Interactive Path Breadcrumbs**: Clickable folder path navigation (`📂 Projects / laptop-space-manager / src`) instead of a single "Up" button
- **Folder "Show" Action**: Reveals folders directly in Windows File Explorer
- **Common Live Search**: Search bar filters both subfolders AND files simultaneously with a matching count summary
- Streamlined two-step selection flow: pick 1 or multiple folders via a single dialog
- **Fast Scan** (`⚡ Fast scan`) for rapid folder/file mapping without content-hashing
- **Full Scan** (`🔥 Full scan`) for complete analysis including automatic duplicate hashing in one step
- **Live List Refresh**: Deleting any file or folder instantly updates all UI tables, tiles, folder trees, duplicate lists, and totals
- Browse folders by size with **Delete Folder** action
- Detect empty folders with **Empty Badge** and empty folder list in Cleanup panel
- Report permission errors and skipped paths in a dedicated **Errors / Skipped** tab
- List view and tile view
- Real-time scan progress bar and elapsed time
- Cancel running scans
- Scan job queue for multiple locations
- Filter by category (videos, images, installers, archives, docs) or minimum size
- Open file location in Windows Explorer
- Move files and folders safely to the Windows Recycle Bin

## Safety principles

- Do not permanently delete files or folders
- Use the Windows Recycle Bin for all delete actions
- Ask confirmation before moving files or folders to trash
- Encourage users to start with personal folders like Downloads, Documents, Pictures, Videos, and Desktop
- Avoid system folders by default

## Performance direction

1. Fast scan first: folder sizes, file sizes, file types, empty folders
2. Full scan: runs fast scan + duplicate content-hashing in one automated sequence
3. Live state mutation: immediately removes trashed items from memory so re-scanning is not required after deletion

## Inspiration from existing tools

- WizTree: very fast disk usage scanning
- TreeSize Free: folder-first navigation by size
- WinDirStat: visual treemap
- SpaceSniffer: block/tile visual storage map
- dupeGuru: duplicate-focused workflow

## Future features

### Near term

- Better tile thumbnails for images and videos
- Sort controls in every table
- Safer duplicate cleanup workflow
- Persistent scan jobs
- Background scan worker process
- Full-disk local index (using SQLite)
