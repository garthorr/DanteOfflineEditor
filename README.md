# Dante Offline Editor

A desktop app for viewing and editing [Dante Controller](https://www.audinate.com/products/software/dante-controller) preset XML files without a live Dante network.

Opens a preset file and renders it as an interactive patch matrix — TX channels across the top, RX channels down the side — so you can route audio by clicking cells, rename TX channel labels, then save the result back to XML.

---

## Features

- **Visual patch grid** — scrollable matrix of every TX channel vs. every RX channel across all devices in the preset
- **One-click routing** — click any cell to subscribe that RX channel to a TX channel; click the active dot again to unsubscribe
- **Inline TX label editing** — double-click any TX channel header to rename it; dependent RX subscriptions update automatically
- **Save / Save As** — writes clean, pretty-printed XML compatible with Dante Controller
- **Unsaved-changes indicator** — title bar and status bar show `●` when there are unsaved edits
- **Hover tooltips** — shows the full RX device/channel and TX device/channel for any cell

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm (included with Node.js)

---

## Installation

```bash
git clone https://github.com/garthorr/DanteOfflineEditor.git
cd DanteOfflineEditor
npm install
```

---

## Running

```bash
npm start
```

---

## Usage

1. Click **Open XML File** (or **File → Open…** / `Ctrl+O`) and select a Dante Controller preset `.xml` file.
2. The patch grid loads with all devices and channels from the preset.
3. **Route a channel** — click a cell at the intersection of an RX row and a TX column. A `●` appears to indicate the subscription. Click it again to clear.
4. **Rename a TX label** — double-click a column header, type the new name, press `Enter` (or `Escape` to cancel).
5. **Save** — `Ctrl+S` to overwrite the original file, `Ctrl+Shift+S` (or **File → Save As…**) to write a new file.

---

## Keyboard Shortcuts

| Action    | Windows / Linux    | macOS           |
|-----------|--------------------|-----------------|
| Open      | `Ctrl+O`           | `Cmd+O`         |
| Save      | `Ctrl+S`           | `Cmd+S`         |
| Save As   | `Ctrl+Shift+S`     | `Cmd+Shift+S`   |

---

## Dante Preset XML Format

The editor reads and writes the XML format exported by **Dante Controller** (`File → Export Preset`). Each `<device>` in the file contains:

- `<txchannel>` elements — outputs with a `<label>`
- `<rxchannel>` elements — inputs with an optional `<subscribed_channel>` and `<subscribed_device>` that define the patch

The editor does not require a network connection or Dante Controller to be installed. The saved XML can be imported back into Dante Controller on any machine.

An example preset is included in the [`example/`](example/) directory.

---

## Project Structure

```
DanteOfflineEditor/
├── main.js        # Electron main process — window, menus, file I/O
├── preload.js     # Context bridge exposing file APIs to the renderer
├── app.js         # Renderer logic — XML parsing, grid rendering, patch editing
├── index.html     # App shell
├── styles.css     # UI styles
├── example/       # Sample Dante Controller preset XML
└── package.json
```

---

## License

[MIT](LICENSE)
