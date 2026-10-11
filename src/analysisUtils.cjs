/**
 * CommonJS bridge for test runner
 */
function compareSnapshots(baseline, target) {
  const baseSize = baseline?.totals?.size || 0
  const targetSize = target?.totals?.size || 0
  const sizeDiff = targetSize - baseSize

  const baseFiles = baseline?.totals?.files || 0
  const targetFiles = target?.totals?.files || 0
  const filesDiff = targetFiles - baseFiles

  const pctChange = baseSize > 0 ? (sizeDiff / baseSize) * 100 : targetSize > 0 ? 100 : 0
  const growthState = sizeDiff > 0 ? 'grown' : sizeDiff < 0 ? 'freed' : 'unchanged'
  const isSameRoot = Boolean(baseline?.rootPath && target?.rootPath && baseline.rootPath === target.rootPath)

  return {
    isSameRoot,
    sizeDiff,
    filesDiff,
    pctChange,
    growthState,
  }
}

function computeTreemapLayout(items, totalSize, x = 0, y = 0, w = 100, h = 100) {
  if (!items || items.length === 0 || w <= 0 || h <= 0) return []

  const validItems = items.filter((it) => (it.size || 0) >= 0)
  if (validItems.length === 0) return []

  if (validItems.length === 1) {
    const item = validItems[0]
    const areaPct = totalSize > 0 ? Math.round(((item.size || 0) / totalSize) * 100) : 0
    return [{ x, y, w, h, item, areaPct }]
  }

  const groupTotal = validItems.reduce((s, it) => s + (it.size || 0), 0)
  if (groupTotal <= 0) {
    const sliceWidth = w / validItems.length
    return validItems.map((item, idx) => ({
      x: x + idx * sliceWidth,
      y,
      w: sliceWidth,
      h,
      item,
      areaPct: 0,
    }))
  }

  let halfSize = 0
  let splitIndex = 0
  for (let i = 0; i < validItems.length; i++) {
    halfSize += validItems[i].size || 0
    if (halfSize >= groupTotal / 2 || i === validItems.length - 2) {
      splitIndex = i + 1
      break
    }
  }

  const group1 = validItems.slice(0, splitIndex)
  const group2 = validItems.slice(splitIndex)
  const g1Size = group1.reduce((s, it) => s + (it.size || 0), 0)
  const ratio = g1Size / groupTotal

  if (w >= h) {
    const w1 = w * ratio
    const w2 = w - w1
    return [
      ...computeTreemapLayout(group1, totalSize, x, y, w1, h),
      ...computeTreemapLayout(group2, totalSize, x + w1, y, w2, h),
    ]
  } else {
    const h1 = h * ratio
    const h2 = h - h1
    return [
      ...computeTreemapLayout(group1, totalSize, x, y, w, h1),
      ...computeTreemapLayout(group2, totalSize, x, y + h1, w, h2),
    ]
  }
}

module.exports = {
  compareSnapshots,
  computeTreemapLayout,
}
