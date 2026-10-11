/**
 * Shared Report Serialization and CSV Escaping Logic
 */

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""'
  const str = String(val)
  // Double-quote any existing double quotes, wrap in quotes
  return `"${str.replace(/"/g, '""')}"`
}

function generateCsvReport(scanResult, options = { full: true }) {
  if (!scanResult) return ''
  const files = options.full && scanResult.files && scanResult.files.length > 0
    ? scanResult.files
    : (scanResult.largestFiles || [])

  const rows = [
    ['Path', 'Name', 'Size (Bytes)', 'Extension', 'Modified At'].map(escapeCsvField).join(','),
  ]

  for (const f of files) {
    const row = [
      escapeCsvField(f.path || ''),
      escapeCsvField(f.name || ''),
      escapeCsvField(f.size !== undefined ? f.size : 0),
      escapeCsvField(f.extension || ''),
      escapeCsvField(f.modifiedAt || ''),
    ].join(',')
    rows.push(row)
  }

  return rows.join('\r\n')
}

function parseCsv(csvText) {
  const lines = []
  let currentRow = []
  let currentField = ''
  let insideQuote = false

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i]
    const nextChar = csvText[i + 1]

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentField += '"'
        i++ // Skip escaped quote
      } else {
        insideQuote = !insideQuote
      }
    } else if (char === ',' && !insideQuote) {
      currentRow.push(currentField)
      currentField = ''
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (char === '\r' && nextChar === '\n') {
        i++
      }
      currentRow.push(currentField)
      currentField = ''
      if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
        lines.push(currentRow)
      }
      currentRow = []
    } else {
      currentField += char
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField)
    lines.push(currentRow)
  }

  return lines
}

module.exports = {
  escapeCsvField,
  generateCsvReport,
  parseCsv,
}
