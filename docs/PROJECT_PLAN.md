# Laptop Space Manager — Project Plan

This document explains what we are building, why we are building it, and how the app should evolve. It is meant to stay in the repository so the project is easy to understand when pushed to GitHub.

## Problem

Laptop storage fills up over time, and files are distributed across many folders with no clear structure. It becomes difficult to know:

- Which folders are using the most storage
- Which files are very large
- Which file types are taking space
- Which files are duplicates
- Which files are safe to delete

## Product goal

Build a simple Windows desktop app that helps users understand and clean laptop storage safely.

The app should be visual, practical, and safe by default.

## Current technology

- React for the user interface
- TypeScript for safer code
- Vite for development/build tooling
- Electron for desktop file-system access

Electron is used because a normal browser app cannot freely scan folders, open files in Explorer, or move files to the Recycle Bin.

## Current features

- Choose a folder to scan
- Fast scan folder/file sizes
- Browse folders by size
- Go inside folders step by step
- List view and tile view
- View largest files
- View file types by total size
- Run duplicate detection separately
- Show fast-scan progress while scanning
- Cancel a running fast scan
- Select multiple scan locations
- Track scan jobs
- Search and filter files
- Review cleanup suggestions
- Queue files before moving them to the Recycle Bin
- Open file location in Windows Explorer
- Move files to the Windows Recycle Bin

## Safety principles

- Do not permanently delete files
- Use the Recycle Bin for delete actions
- Ask confirmation before moving files to trash
- Encourage users to start with personal folders like Downloads, Documents, Pictures, Videos, and Desktop
- Avoid system folders by default

## Performance direction

The first version tried to find duplicates during the normal scan. That was slow because duplicate detection requires reading file contents.

The improved approach is:

1. Fast scan first
   - folder sizes
   - file sizes
   - file types
2. Duplicate scan only when requested
   - compare same-size files
   - hash contents only for possible duplicates

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
- Full-disk local index

### Full laptop management

Add a local disk index so the app can manage the complete laptop instead of scanning one folder every time.

Possible flow:

1. First full scan creates a local map of files and folders.
2. App opens later and loads the previous map instantly.
3. A background refresh checks what changed.
4. New files are added, deleted files are removed, changed files are updated.

Possible stored fields:

- file path
- file name
- file extension/type
- file size
- modified date
- created date
- parent folder
- optional content hash for duplicate detection

### Local storage options

Start simple:

- JSON file for small experiments

Better long-term:

- SQLite database stored locally in the app data folder

SQLite is better for a large file index because it can sort, filter, and update many records efficiently without needing a backend server.

## Possible app sections

- Dashboard
- Folder Browser
- Files
- File Types
- Duplicates
- Cleanup Suggestions
- Settings

## Deployment / distribution later

This project can be pushed to GitHub as source code first. Later, it can be packaged into a Windows installer using Electron packaging tools.
