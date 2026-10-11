const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { scanFolder, findDuplicates, hashFile, moveToTrash, isProtectedSystemPath, isAllowedImagePath, addAllowedRoot } = require('../electron/main.cjs')
const { generateCsvReport, generateJsonReport, parseCsv, escapeCsvField } = require('../src/reportUtils.cjs')
const { compareSnapshots, computeTreemapLayout } = require('../src/analysisUtils.cjs')

test('Laptop Space Manager - Backend Test Suite', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsm-test-'))

  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  await t.test('1. Deletion failure preserves real file and throws clear error (no fs.rm fallback)', async () => {
    // 1a. Test with real existing file and a forced/mocked trash failure
    const realFile = path.join(tmpDir, 'important-user-doc.pdf')
    const originalContent = 'IMPORTANT USER DATA THAT MUST NEVER BE PERMANENTLY DELETED'
    await fs.writeFile(realFile, originalContent, 'utf8')

    // Mock trashItem to simulate failure (e.g. Windows file lock or permission error)
    const mockedTrashItemFailure = async (_path) => {
      throw new Error('EPERM: operation not permitted, simulated Recycle Bin failure')
    }

    await assert.rejects(
      async () => {
        await moveToTrash(realFile, { trashItem: mockedTrashItemFailure })
      },
      /Failed to move "important-user-doc.pdf" to Recycle Bin.*File was preserved/i,
      'Should throw explicit error with preserved file notification'
    )

    // CRITICAL SAFETY ASSERTION: Verify that the real file still exists and its content is intact!
    const fileStillExists = await fs.stat(realFile).then(() => true).catch(() => false)
    assert.equal(fileStillExists, true, 'Real file MUST still exist on disk after trash failure!')

    const currentContent = await fs.readFile(realFile, 'utf8')
    assert.equal(currentContent, originalContent, 'Real file content MUST be completely unchanged!')

    // 1b. Test with successful mock trashItem
    let trashedPath = null
    const mockedTrashItemSuccess = async (p) => {
      trashedPath = p
    }
    const successResult = await moveToTrash(realFile, { trashItem: mockedTrashItemSuccess })
    assert.equal(successResult, true, 'Should return true on successful trash')
    assert.equal(trashedPath, path.normalize(path.resolve(realFile)), 'Should pass normalized path to trashItem')

    // 1c. Test validation on empty path
    await assert.rejects(
      async () => {
        await moveToTrash('')
      },
      /Path must be specified/i
    )

    // 1d. Test system folder protection blocks deletion
    assert.equal(isProtectedSystemPath('C:\\Windows'), true)
    assert.equal(isProtectedSystemPath('C:\\Windows\\System32'), true)
    assert.equal(isProtectedSystemPath('C:\\Program Files'), true)
    assert.equal(isProtectedSystemPath('C:'), true)
    assert.equal(isProtectedSystemPath(realFile), false)

    await assert.rejects(
      async () => {
        await moveToTrash('C:\\Windows\\System32\\calc.exe')
      },
      /Protection Error: Deletion of system or protected path/i,
      'System paths must be strictly blocked from deletion'
    )
  })

  await t.test('2. Streaming SHA-256 duplicate detection groups identical files by content', async () => {
    const fileA = path.join(tmpDir, 'fileA.txt')
    const fileB = path.join(tmpDir, 'fileB.txt')
    const fileC = path.join(tmpDir, 'fileC.txt')

    const duplicateContent = 'Hello World - Duplicate Content Testing 12345'
    const uniqueContent = 'Different content completely unique'

    await fs.writeFile(fileA, duplicateContent)
    await fs.writeFile(fileB, duplicateContent)
    await fs.writeFile(fileC, uniqueContent)

    const hashA = await hashFile(fileA)
    const hashB = await hashFile(fileB)
    const hashC = await hashFile(fileC)

    assert.equal(hashA, hashB, 'Identical files must yield identical hashes')
    assert.notEqual(hashA, hashC, 'Distinct files must yield different hashes')

    const statA = await fs.stat(fileA)
    const statB = await fs.stat(fileB)
    const statC = await fs.stat(fileC)

    const files = [
      { path: fileA, name: 'fileA.txt', size: statA.size },
      { path: fileB, name: 'fileB.txt', size: statB.size },
      { path: fileC, name: 'fileC.txt', size: statC.size },
    ]

    const progressReports = []
    const duplicateGroups = await findDuplicates(files, {
      onProgress: (p) => progressReports.push(p),
    })

    assert.equal(duplicateGroups.length, 1, 'Should identify exactly one duplicate group')
    assert.equal(duplicateGroups[0].files.length, 2, 'Duplicate group should contain fileA and fileB')
    assert.ok(progressReports.some((p) => p.phase === 'hashing'), 'Should emit hashing phase progress')
  })

  await t.test('3. Scan cancellation halts directory scanning without being swallowed in nested catches', async () => {
    // Create nested directory structure with files
    const parentDir = path.join(tmpDir, 'cancel-test-parent')
    const childDir1 = path.join(parentDir, 'child1')
    const childDir2 = path.join(parentDir, 'child2')
    await fs.mkdir(childDir1, { recursive: true })
    await fs.mkdir(childDir2, { recursive: true })
    await fs.writeFile(path.join(childDir1, 'f1.txt'), 'hello')
    await fs.writeFile(path.join(childDir2, 'f2.txt'), 'world')

    const signal = { cancelled: false }

    // Trigger cancellation during progress callback while scanning
    const scanPromise = scanFolder(parentDir, {
      signal,
      onProgress: () => {
        signal.cancelled = true
      },
    })

    await assert.rejects(
      async () => {
        await scanPromise
      },
      (err) => {
        assert.equal(err.code, 'SCAN_CANCELLED', 'Cancellation must rethrow as SCAN_CANCELLED and not be swallowed')
        return true
      },
      'scanFolder should reject with SCAN_CANCELLED even in nested directories'
    )

    // Test duplicate hashing cancellation
    const dummyFiles = [
      { path: path.join(childDir1, 'f1.txt'), size: 5 },
      { path: path.join(childDir2, 'f2.txt'), size: 5 },
    ]

    const cancelledSignal = { cancelled: true }
    await assert.rejects(
      async () => {
        await findDuplicates(dummyFiles, { signal: cancelledSignal })
      },
      (err) => {
        assert.equal(err.code, 'SCAN_CANCELLED')
        return true
      },
      'findDuplicates should reject with SCAN_CANCELLED when cancelled'
    )
  })

  await t.test('4. Empty-folder detection correctly identifies zero-file directories', async () => {
    const emptySubDir1 = path.join(tmpDir, 'empty-dir-1')
    const emptySubDir2 = path.join(emptySubDir1, 'nested-empty-dir')
    const nonEmptyDir = path.join(tmpDir, 'non-empty-dir')

    await fs.mkdir(emptySubDir2, { recursive: true })
    await fs.mkdir(nonEmptyDir, { recursive: true })
    await fs.writeFile(path.join(nonEmptyDir, 'file.txt'), 'some data')

    const scanResult = await scanFolder(tmpDir)

    const emptyPaths = scanResult.emptyFolders.map((f) => f.path)
    assert.ok(emptyPaths.includes(emptySubDir1), 'empty-dir-1 should be listed in emptyFolders')
    assert.ok(emptyPaths.includes(emptySubDir2), 'nested-empty-dir should be listed in emptyFolders')
    assert.ok(!emptyPaths.includes(nonEmptyDir), 'non-empty-dir must NOT be in emptyFolders')
    assert.equal(
      scanResult.totals.emptyFolders,
      scanResult.emptyFolders.length,
      'totals.emptyFolders count must match emptyFolders array length'
    )
  })

  await t.test('5. System and drive path protection blocks sensitive root deletions', () => {
    assert.equal(isProtectedSystemPath('C:'), true)
    assert.equal(isProtectedSystemPath('c:\\'), true)
    assert.equal(isProtectedSystemPath('D:'), true)
    assert.equal(isProtectedSystemPath('C:\\Windows'), true)
    assert.equal(isProtectedSystemPath('C:\\Windows\\System32\\drivers'), true)
    assert.equal(isProtectedSystemPath('C:\\Program Files'), true)
    assert.equal(isProtectedSystemPath('C:\\Program Files (x86)'), true)
    assert.equal(isProtectedSystemPath('C:\\ProgramData'), true)
    assert.equal(isProtectedSystemPath('C:\\Users\\shresh\\Desktop\\MyFolder'), false)
  })

  await t.test('6. Symlinks are skipped during scan to prevent traversal loops', async () => {
    const loopDir = path.join(tmpDir, 'symlink-test')
    await fs.mkdir(loopDir, { recursive: true })
    const targetFile = path.join(loopDir, 'real-file.txt')
    await fs.writeFile(targetFile, 'content')

    const symlinkPath = path.join(loopDir, 'link-to-real')
    try {
      await fs.symlink(targetFile, symlinkPath, 'file')
    } catch {
      // Windows without Developer Mode may restrict symlink creation
      return
    }

    const scanResult = await scanFolder(loopDir)
    const scannedPaths = scanResult.files.map((f) => f.path)
    assert.ok(scannedPaths.includes(targetFile), 'Real file should be scanned')
    assert.ok(!scannedPaths.includes(symlinkPath), 'Symlink must be skipped')
  })

  await t.test('7. Report generation serialization matches data schema', () => {
    const mockFiles = [
      { path: 'C:\\test\\doc.pdf', name: 'doc.pdf', size: 1024, extension: '.pdf', modifiedAt: '2026-01-01T00:00:00.000Z' },
      { path: 'C:\\test\\tricky,name"with"quotes\nandnewline.txt', name: 'tricky,name"with"quotes\nandnewline.txt', size: 2048, extension: '.txt', modifiedAt: '2026-01-02T00:00:00.000Z' },
    ]

    const mockResult = {
      files: mockFiles,
      largestFiles: mockFiles,
    }

    const csvOutput = generateCsvReport(mockResult, { full: true })
    const parsed = parseCsv(csvOutput)

    assert.equal(parsed.length, 3, 'Header + 2 rows = 3 rows total')
    assert.equal(parsed[0][0], 'Path')
    assert.equal(parsed[1][1], 'doc.pdf')
    assert.equal(parsed[2][1], 'tricky,name"with"quotes\nandnewline.txt', 'CSV parsing must correctly round-trip quotes, commas, and newlines')
  })

  await t.test('8. Full CSV export exports > 250 files without truncating', () => {
    const manyFiles = []
    for (let i = 0; i < 300; i++) {
      manyFiles.push({
        path: `C:\\dummy\\file_${i}.dat`,
        name: `file_${i}.dat`,
        size: 100 + i,
        extension: '.dat',
        modifiedAt: new Date().toISOString(),
      })
    }

    const mockResult = {
      files: manyFiles,
      largestFiles: manyFiles.slice(0, 250), // Limited top list
    }

    const fullCsv = generateCsvReport(mockResult, { full: true })
    const parsedFull = parseCsv(fullCsv)
    assert.equal(parsedFull.length, 301, 'Full export must include header + all 300 files (not truncated at 250)')

    const topCsv = generateCsvReport(mockResult, { full: false })
    const parsedTop = parseCsv(topCsv)
    assert.equal(parsedTop.length, 251, 'Top export must include header + 250 files')
  })

  await t.test('9. Snapshots preserve multiple historical scans and allow delta comparisons', () => {
    const scan1 = {
      rootPath: 'C:\\Projects',
      scannedAt: '2026-01-01T10:00:00.000Z',
      totals: { size: 1000000, files: 50 },
    }
    const scan2 = {
      rootPath: 'C:\\Projects',
      scannedAt: '2026-01-02T10:00:00.000Z',
      totals: { size: 1500000, files: 60 },
    }
    const scan3 = {
      rootPath: 'C:\\Projects',
      scannedAt: '2026-01-03T10:00:00.000Z',
      totals: { size: 800000, files: 40 },
    }
    const diffScanRoot = {
      rootPath: 'D:\\Media',
      scannedAt: '2026-01-03T11:00:00.000Z',
      totals: { size: 800000, files: 40 },
    }

    // 9a. Growing scan
    const cmpGrown = compareSnapshots(scan1, scan2)
    assert.equal(cmpGrown.isSameRoot, true)
    assert.equal(cmpGrown.sizeDiff, 500000)
    assert.equal(cmpGrown.filesDiff, 10)
    assert.equal(cmpGrown.growthState, 'grown')
    assert.equal(cmpGrown.pctChange, 50)

    // 9b. Freeing space (negative change)
    const cmpFreed = compareSnapshots(scan2, scan3)
    assert.equal(cmpFreed.sizeDiff, -700000)
    assert.equal(cmpFreed.filesDiff, -20)
    assert.equal(cmpFreed.growthState, 'freed')

    // 9c. Equal scans (no change)
    const cmpEqual = compareSnapshots(scan1, scan1)
    assert.equal(cmpEqual.sizeDiff, 0)
    assert.equal(cmpEqual.filesDiff, 0)
    assert.equal(cmpEqual.growthState, 'unchanged')

    // 9d. Different scan roots flagged
    const cmpDiffRoots = compareSnapshots(scan1, diffScanRoot)
    assert.equal(cmpDiffRoots.isSameRoot, false, 'Should flag comparisons across differing root directories')

    // 9e. Backward compatibility: snapshots without IDs or missing totals do not throw
    const oldSnapshotWithoutId = { rootPath: 'C:\\Old' }
    const cmpOld = compareSnapshots(oldSnapshotWithoutId, scan1)
    assert.equal(cmpOld.growthState, 'grown')
  })

  await t.test('10. JSON report generation produces parseable output with summary option', () => {
    const mockResult = {
      rootPath: 'C:\\TestScan',
      scannedAt: '2026-03-01T12:00:00.000Z',
      totals: { size: 4096, files: 2 },
      files: [{ path: 'C:\\TestScan\\a.txt', name: 'a.txt', size: 2048 }],
      largestFiles: [{ path: 'C:\\TestScan\\a.txt', name: 'a.txt', size: 2048 }],
    }

    const fullJson = generateJsonReport(mockResult, { full: true })
    const parsedFull = JSON.parse(fullJson)
    assert.equal(parsedFull.rootPath, 'C:\\TestScan')
    assert.equal(parsedFull.files.length, 1)

    const summaryJson = generateJsonReport(mockResult, { full: false })
    const parsedSummary = JSON.parse(summaryJson)
    assert.equal(parsedSummary.rootPath, 'C:\\TestScan')
    assert.equal(parsedSummary.topFiles.length, 1)
    assert.equal(parsedSummary.files, undefined, 'Summary report should omit the raw full file list')
  })

  await t.test('11. Security validation for atom:// image protocol denies unauthorized/executable paths', () => {
    // Unrestricted / default root set
    assert.equal(isAllowedImagePath('C:\\Users\\user\\Pictures\\photo.png'), true)
    assert.equal(isAllowedImagePath('C:\\Users\\user\\Pictures\\photo with spaces.jpeg'), true)
    assert.equal(isAllowedImagePath('C:\\Users\\user\\Pictures\\emoji_📷.webp'), true)
    // Disallowed: executables, scripts, protected system paths
    assert.equal(isAllowedImagePath('C:\\Users\\user\\Downloads\\installer.exe'), false)
    assert.equal(isAllowedImagePath('C:\\Users\\user\\System32\\cmd.exe'), false)
    assert.equal(isAllowedImagePath('C:\\Windows\\Web\\Wallpaper\\img.jpg'), false, 'Protected system directories must be blocked')

    // Scoped root testing: only allow files inside permitted scan roots
    const permittedRoots = new Set(['c:\\users\\user\\pictures'])
    assert.equal(isAllowedImagePath('C:\\Users\\user\\Pictures\\vacation.jpg', permittedRoots), true)
    assert.equal(isAllowedImagePath('C:\\Users\\user\\Documents\\secret.jpg', permittedRoots), false, 'Image outside permitted root must be denied')

    // Path traversal attacks (e.g. attempting to break out of root via ..)
    const traversalAttempt = 'C:\\Users\\user\\Pictures\\..\\Documents\\leak.png'
    assert.equal(isAllowedImagePath(traversalAttempt, permittedRoots), false, 'Path traversal must be neutralized by normalization and denied')
  })

  await t.test('12. Proportional Treemap calculation handles zero-sized, uneven, and empty folders', () => {
    // 12a. Proportional area test: Folder A is twice as large as Folder B
    const items = [
      { path: 'C:\\A', name: 'A', size: 200 },
      { path: 'C:\\B', name: 'B', size: 100 },
    ]
    const layout = computeTreemapLayout(items, 300, 0, 0, 100, 100)
    assert.equal(layout.length, 2)
    const areaA = layout[0].w * layout[0].h
    const areaB = layout[1].w * layout[1].h
    assert.ok(Math.abs(areaA / areaB - 2.0) < 0.05, 'Item A area should be ~2x Item B area')

    // 12b. Zero-sized folders do not crash and produce safe layout
    const zeroItems = [
      { path: 'C:\\Zero1', name: 'Zero1', size: 0 },
      { path: 'C:\\Zero2', name: 'Zero2', size: 0 },
    ]
    const zeroLayout = computeTreemapLayout(zeroItems, 0)
    assert.equal(zeroLayout.length, 2)
    assert.equal(zeroLayout[0].areaPct, 0)

    // 12c. Empty list returns empty nodes
    assert.deepEqual(computeTreemapLayout([], 0), [])
  })
})
