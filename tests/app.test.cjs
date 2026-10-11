const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { scanFolder, findDuplicates, hashFile, moveToTrash } = require('../electron/main.cjs')

test('Laptop Space Manager - Backend Test Suite', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsm-test-'))

  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  await t.test('1. Deletion failure preserves file and throws clear error (no fs.rm fallback)', async () => {
    const nonExistentFile = path.join(tmpDir, 'does-not-exist-file.txt')
    await assert.rejects(
      async () => {
        await moveToTrash(nonExistentFile)
      },
      /Failed to move.*to Recycle Bin.*File was preserved/i,
      'Should throw explicit error and never silently fall back or succeed'
    )

    // Ensure empty path also throws error
    await assert.rejects(
      async () => {
        await moveToTrash('')
      },
      /Path must be specified/i
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

  await t.test('3. Scan cancellation halts directory scanning and duplicate hashing', async () => {
    const cancelledSignal = { cancelled: true }

    await assert.rejects(
      async () => {
        await scanFolder(tmpDir, { signal: cancelledSignal })
      },
      (err) => {
        assert.equal(err.code, 'SCAN_CANCELLED')
        return true
      },
      'scanFolder should reject with SCAN_CANCELLED when cancelled'
    )

    const dummyFiles = [
      { path: path.join(tmpDir, 'fileA.txt'), size: 100 },
      { path: path.join(tmpDir, 'fileB.txt'), size: 100 },
    ]

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
})
