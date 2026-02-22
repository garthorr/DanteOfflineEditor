'use strict'

// ── State ────────────────────────────────────────────────────────────────────

let xmlDoc = null
let devices = []        // parsed device objects
let currentFilePath = null
let isDirty = false
let fileHandle = null   // FileSystemFileHandle (File System Access API), if available

// ── XML Parsing ───────────────────────────────────────────────────────────────

function parseXML(xmlString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'text/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error(err.textContent.split('\n')[0])
  return doc
}

/**
 * Extract devices from the parsed XML doc.
 * Each device object holds direct references to the XML elements
 * so mutations are reflected when we serialize.
 */
function extractDevices(doc) {
  const result = []
  doc.querySelectorAll('preset > device').forEach(devEl => {
    const name = getText(devEl, 'name')
    const friendly = getText(devEl, 'friendly_name') || name

    const txChannels = []
    devEl.querySelectorAll(':scope > txchannel').forEach(el => {
      txChannels.push({
        danteId: el.getAttribute('danteId'),
        label: getText(el, 'label') || el.getAttribute('danteId'),
        element: el
      })
    })

    const rxChannels = []
    devEl.querySelectorAll(':scope > rxchannel').forEach(el => {
      rxChannels.push({
        danteId: el.getAttribute('danteId'),
        name: getText(el, 'name') || el.getAttribute('danteId'),
        subscribedChannel: getText(el, 'subscribed_channel'),
        subscribedDevice: getText(el, 'subscribed_device'),
        element: el
      })
    })

    result.push({ name, friendly, txChannels, rxChannels, element: devEl })
  })
  return result
}

function getText(parent, tagName) {
  const el = parent.querySelector(':scope > ' + tagName)
  return el ? el.textContent.trim() : null
}

// ── XML Serialization ─────────────────────────────────────────────────────────

function serializeXML(doc) {
  const serializer = new XMLSerializer()
  let raw = serializer.serializeToString(doc)

  // Ensure proper XML declaration
  if (!raw.startsWith('<?xml')) {
    raw = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + raw
  }

  return prettyPrint(raw)
}

function prettyPrint(xml) {
  const INDENT = '  '
  const lines = xml.replace(/>\s*</g, '>\n<').split('\n')
  let depth = 0
  let out = ''

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const isClose = line.startsWith('</')
    const isSelfClose = line.endsWith('/>')
    const isDecl = line.startsWith('<?') || line.startsWith('<!')

    if (isClose) depth = Math.max(0, depth - 1)

    out += INDENT.repeat(depth) + line + '\n'

    if (!isClose && !isSelfClose && !isDecl && line.startsWith('<') && !line.includes('</')) {
      depth++
    }
  }
  return out
}

// ── DOM update helpers ────────────────────────────────────────────────────────

function setSubscription(rxElement, channel, device) {
  let chEl = rxElement.querySelector('subscribed_channel')
  let devEl = rxElement.querySelector('subscribed_device')

  if (channel === null) {
    if (chEl) rxElement.removeChild(chEl)
    if (devEl) rxElement.removeChild(devEl)
    return
  }

  if (!chEl) {
    chEl = xmlDoc.createElement('subscribed_channel')
    rxElement.appendChild(chEl)
  }
  chEl.textContent = channel

  if (!devEl) {
    devEl = xmlDoc.createElement('subscribed_device')
    rxElement.appendChild(devEl)
  }
  devEl.textContent = device
}

function setTxLabel(txElement, label) {
  let labelEl = txElement.querySelector('label')
  if (!labelEl) {
    labelEl = xmlDoc.createElement('label')
    txElement.appendChild(labelEl)
  }
  labelEl.textContent = label
}

// ── Grid rendering ────────────────────────────────────────────────────────────

function renderGrid() {
  const table = document.getElementById('patch-grid')
  table.innerHTML = ''

  const thead = document.createElement('thead')
  const row1 = document.createElement('tr')   // device name headers
  const row2 = document.createElement('tr')   // tx channel label headers

  // Corner cell spans both header rows and both sticky columns
  const corner = document.createElement('th')
  corner.rowSpan = 2
  corner.colSpan = 2
  corner.className = 'corner-cell'
  corner.innerHTML = `
    <svg class="corner-diag" preserveAspectRatio="none">
      <line x1="0" y1="0" x2="100%" y2="100%" stroke="#2a2a4a" stroke-width="1"/>
    </svg>
    <div class="corner-label">
      <span style="align-self:flex-end;padding-right:6px;color:#4a4a7a">TX ▶</span>
      <span style="align-self:flex-start;padding-left:6px;color:#4a4a7a">◀ RX</span>
    </div>`
  row1.appendChild(corner)

  // TX device headers (row 1) and TX channel headers (row 2)
  devices.forEach(dev => {
    if (dev.txChannels.length === 0) return

    const th = document.createElement('th')
    th.colSpan = dev.txChannels.length
    th.className = 'tx-device-header'
    th.textContent = dev.friendly
    th.title = `${dev.name}\n${dev.txChannels.length} TX channels`
    row1.appendChild(th)

    dev.txChannels.forEach((tx, txIdx) => {
      const th2 = document.createElement('th')
      th2.className = 'tx-ch-header'
      th2.dataset.devName = dev.name
      th2.dataset.txId = tx.danteId

      // Rotated label (double-click to edit)
      const span = document.createElement('span')
      span.className = 'tx-label-rotated'
      span.textContent = tx.label
      span.title = `${dev.friendly} — ${tx.label}\nDouble-click to rename`

      // Hidden input for inline editing
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'tx-label-input'
      input.value = tx.label

      span.addEventListener('dblclick', () => startTxEdit(span, input, tx, dev))
      input.addEventListener('blur', () => commitTxEdit(span, input, tx, dev))
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur()
        if (e.key === 'Escape') {
          input.value = tx.label
          input.blur()
        }
      })

      th2.appendChild(span)
      th2.appendChild(input)
      row2.appendChild(th2)
    })
  })

  thead.appendChild(row1)
  thead.appendChild(row2)
  table.appendChild(thead)

  // tbody: one row per RX channel
  const tbody = document.createElement('tbody')

  // Pre-build column index: txDeviceName+label → column index (0-based from data cells)
  const colIndex = buildColIndex()

  devices.forEach(dev => {
    if (dev.rxChannels.length === 0) return

    dev.rxChannels.forEach((rx, rxIdx) => {
      const tr = document.createElement('tr')
      if (rxIdx === 0) tr.classList.add('device-first-row')

      // RX device name cell (rowspan for entire device block)
      if (rxIdx === 0) {
        const tdDev = document.createElement('td')
        tdDev.rowSpan = dev.rxChannels.length
        tdDev.className = 'rx-dev-cell'
        tdDev.textContent = dev.friendly
        tdDev.title = `${dev.name}\n${dev.rxChannels.length} RX channels`
        tr.appendChild(tdDev)
      }

      // RX channel name cell
      const tdRx = document.createElement('td')
      tdRx.className = 'rx-ch-cell'
      tdRx.textContent = rx.name
      tdRx.title = `${dev.friendly} — RX ${rx.danteId}: ${rx.name}`
      tr.appendChild(tdRx)

      // Patch cells — one per TX channel across all devices
      let colPos = 0
      devices.forEach(txDev => {
        if (txDev.txChannels.length === 0) return
        txDev.txChannels.forEach((tx, txIdx) => {
          const td = document.createElement('td')
          td.className = 'patch-cell'
          if (txIdx === txDev.txChannels.length - 1) td.classList.add('dev-last-col')

          const isSubscribed =
            rx.subscribedDevice === txDev.name &&
            rx.subscribedChannel === tx.label

          if (isSubscribed) {
            td.classList.add('subscribed')
            td.textContent = '●'
          }

          td.title = `RX: ${dev.friendly} / ${rx.name}\nTX: ${txDev.friendly} / ${tx.label}`

          td.addEventListener('click', () =>
            handlePatchClick(td, dev, rx, txDev, tx, tr)
          )

          // Tooltip on hover for subscribed cells
          td.addEventListener('mouseenter', e => showTooltip(e, td, dev, rx, txDev, tx))
          td.addEventListener('mouseleave', hideTooltip)

          tr.appendChild(td)
          colPos++
        })
      })

      tbody.appendChild(tr)
    })
  })

  table.appendChild(tbody)

  document.getElementById('grid-wrapper').style.display = 'block'
  document.getElementById('empty-state').style.display = 'none'
}

function buildColIndex() {
  const idx = {}
  let col = 0
  devices.forEach(dev => {
    dev.txChannels.forEach(tx => {
      idx[dev.name + '\x00' + tx.label] = col++
    })
  })
  return idx
}

// ── Patch cell interaction ────────────────────────────────────────────────────

function handlePatchClick(cell, rxDev, rx, txDev, tx, tr) {
  const wasSubscribed =
    rx.subscribedDevice === txDev.name &&
    rx.subscribedChannel === tx.label

  // Clear all subscribed cells in this row
  tr.querySelectorAll('.patch-cell.subscribed').forEach(c => {
    c.classList.remove('subscribed')
    c.textContent = ''
  })

  if (wasSubscribed) {
    // Clicked the active dot → unsubscribe
    rx.subscribedDevice = null
    rx.subscribedChannel = null
    setSubscription(rx.element, null, null)
  } else {
    // Subscribe to new TX
    rx.subscribedDevice = txDev.name
    rx.subscribedChannel = tx.label
    cell.classList.add('subscribed')
    cell.textContent = '●'
    setSubscription(rx.element, tx.label, txDev.name)
  }

  markDirty(true)
}

// ── TX label inline editing ───────────────────────────────────────────────────

function startTxEdit(span, input, tx, dev) {
  span.style.display = 'none'
  input.style.display = 'block'
  input.value = tx.label
  input.focus()
  input.select()
}

function commitTxEdit(span, input, tx, dev) {
  const newLabel = input.value.trim()
  input.style.display = 'none'
  span.style.display = 'block'

  if (!newLabel || newLabel === tx.label) return

  // Update any RX subscriptions that referenced the old label
  const oldLabel = tx.label
  devices.forEach(d => {
    d.rxChannels.forEach(rx => {
      if (rx.subscribedDevice === dev.name && rx.subscribedChannel === oldLabel) {
        rx.subscribedChannel = newLabel
        setSubscription(rx.element, newLabel, dev.name)
      }
    })
  })

  tx.label = newLabel
  span.textContent = newLabel
  span.title = `${dev.friendly} — ${newLabel}\nDouble-click to rename`
  setTxLabel(tx.element, newLabel)

  // Also refresh any subscribed dots' title attributes in the grid
  document.querySelectorAll('.patch-cell.subscribed').forEach(cell => {
    // Simple approach: tooltip will regenerate on next hover
  })

  markDirty(true)
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const tooltip = document.getElementById('tooltip')

function showTooltip(e, cell, rxDev, rx, txDev, tx) {
  const isSubscribed = cell.classList.contains('subscribed')
  if (!isSubscribed) {
    tooltip.innerHTML = `<b>RX</b> ${rxDev.friendly} / <b>${rx.name}</b><br><b>TX</b> ${txDev.friendly} / <b>${tx.label}</b>`
  } else {
    tooltip.innerHTML = `<b>✔ Patched</b><br>RX: ${rxDev.friendly} / <b>${rx.name}</b><br>TX: ${txDev.friendly} / <b>${tx.label}</b>`
  }
  tooltip.style.display = 'block'
  positionTooltip(e)
}

function hideTooltip() {
  tooltip.style.display = 'none'
}

document.addEventListener('mousemove', e => {
  if (tooltip.style.display === 'block') positionTooltip(e)
})

function positionTooltip(e) {
  const pad = 12
  let x = e.clientX + pad
  let y = e.clientY + pad
  const tw = tooltip.offsetWidth
  const th = tooltip.offsetHeight
  if (x + tw > window.innerWidth - 4) x = e.clientX - tw - pad
  if (y + th > window.innerHeight - 4) y = e.clientY - th - pad
  tooltip.style.left = x + 'px'
  tooltip.style.top = y + 'px'
}

// ── Dirty / unsaved state ─────────────────────────────────────────────────────

function markDirty(dirty) {
  isDirty = dirty
  document.getElementById('status').textContent = dirty ? '● Unsaved changes' : ''
  document.title = dirty ? '● Dante Offline Editor' : 'Dante Offline Editor'
}

// ── File operations ───────────────────────────────────────────────────────────

function openFile() {
  // Must be synchronous — Safari only allows file-input.click() from a
  // synchronous user gesture handler. async functions lose that context.
  if (window.showOpenFilePicker && location.protocol !== 'file:') {
    _openWithPicker()
    return
  }
  document.getElementById('file-input').click()
}

async function _openWithPicker() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Dante Preset', accept: { 'text/xml': ['.xml'] } }]
    })
    fileHandle = handle
    const file = await handle.getFile()
    await loadContent(file.name, await file.text())
  } catch (e) {
    if (e.name !== 'AbortError') document.getElementById('file-input').click()
  }
}

async function handleFileInputChange(e) {
  const file = e.target.files[0]
  if (!file) return
  fileHandle = null
  const text = typeof file.text === 'function'
    ? await file.text()
    : await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result)
        r.onerror = () => rej(r.error)
        r.readAsText(file)
      })
  await loadContent(file.name, text)
  e.target.value = ''
}

async function loadContent(fileName, content) {
  try {
    xmlDoc = parseXML(content)
    devices = extractDevices(xmlDoc)
    currentFilePath = fileName

    document.getElementById('file-name').textContent = fileName
    document.getElementById('file-name').title = fileName

    const presetName = xmlDoc.querySelector('preset > name')?.textContent || ''
    const presetDesc = xmlDoc.querySelector('preset > description')?.textContent || ''
    document.getElementById('preset-name').textContent = presetName
    document.getElementById('preset-desc').textContent = presetDesc
    document.getElementById('preset-info').style.display = 'flex'

    document.getElementById('btn-save').disabled = false
    document.getElementById('btn-save-as').disabled = false

    renderGrid()
    markDirty(false)
  } catch (err) {
    alert('Failed to parse XML:\n' + err.message)
  }
}

async function saveFile(saveAs = false) {
  if (!xmlDoc) return
  const content = serializeXML(xmlDoc)
  const suggestedName = currentFilePath || 'dante-preset.xml'

  // In-place save via stored file handle (File System Access API)
  if (!saveAs && fileHandle) {
    try {
      const perm = await fileHandle.queryPermission({ mode: 'readwrite' })
      if (perm !== 'granted') await fileHandle.requestPermission({ mode: 'readwrite' })
      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()
      markDirty(false)
      return
    } catch (_) { /* fall through */ }
  }

  // Save dialog via File System Access API (Chrome/Edge, https:// only)
  if (window.showSaveFilePicker && location.protocol !== 'file:') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Dante Preset', accept: { 'text/xml': ['.xml'] } }]
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      fileHandle = handle
      markDirty(false)
      return
    } catch (e) {
      if (e.name === 'AbortError') return
    }
  }

  // Fallback: trigger browser download
  const blob = new Blob([content], { type: 'text/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
  markDirty(false)
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.getElementById('btn-open').addEventListener('click', openFile)
document.getElementById('btn-open-large').addEventListener('click', openFile)
document.getElementById('btn-save').addEventListener('click', () => saveFile(false))
document.getElementById('btn-save-as').addEventListener('click', () => saveFile(true))
document.getElementById('file-input').addEventListener('change', handleFileInputChange)

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key === 'o') { e.preventDefault(); openFile() }
  if (mod && !e.shiftKey && e.key === 's') { e.preventDefault(); saveFile(false) }
  if (mod && e.shiftKey && e.key === 'S') { e.preventDefault(); saveFile(true) }
})

// Electron menu integration (when running under Electron)
if (window.electronAPI) {
  window.electronAPI.onMenuOpen(() => openFile())
  window.electronAPI.onMenuSave(() => saveFile(false))
  window.electronAPI.onMenuSaveAs(() => saveFile(true))
}
