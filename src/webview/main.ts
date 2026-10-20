import JSONEditor, {
  type JSONEditorMode,
  type JSONEditorOptions
} from 'jsoneditor'
import 'jsoneditor/dist/jsoneditor.css'
import './webview.css'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

type IncomingMessage =
  | {
      type: 'render'
      uri: string
      json: JsonValue
      text: string
      fileName: string
    }
  | {
      type: 'error'
      uri: string
      text: string
      fileName: string
      message: string
    }
  | { type: 'empty'; message: string }
  | { type: 'saved' }

type WebviewState = {
  mode?: JSONEditorMode
  readOnly?: boolean
}

const MODES: JSONEditorMode[] = [
  'tree',
  'code',
  'text',
  'preview'
]

const vscode = acquireVsCodeApi()
const savedState = (vscode.getState() as WebviewState | undefined) ?? {}
const editorElement = document.getElementById('editor') as HTMLElement
const stateElement = document.getElementById('state') as HTMLElement
const stateTitle = document.getElementById('state-title') as HTMLElement
const stateMessage = document.getElementById('state-message') as HTMLElement
const banner = document.getElementById('banner') as HTMLElement
const bannerMessage = document.getElementById(
  'banner-message'
) as HTMLElement
const bannerClose = document.getElementById(
  'banner-close'
) as HTMLButtonElement
const diffDialog = document.getElementById('diff-dialog') as HTMLDialogElement
const diffForm = document.getElementById('diff-form') as HTMLFormElement
const diffBaseline = document.getElementById(
  'diff-baseline'
) as HTMLTextAreaElement
const diffError = document.getElementById('diff-error') as HTMLElement
const diffCancel = document.getElementById('diff-cancel') as HTMLButtonElement
const compareView = document.getElementById('compare-view') as HTMLElement
const compareBaselineElement = document.getElementById(
  'compare-baseline-editor'
) as HTMLElement
const compareCurrentElement = document.getElementById(
  'compare-current-editor'
) as HTMLElement
const compareToggle = document.getElementById(
  'compare-toggle'
) as HTMLButtonElement
const comparePrevious = document.getElementById(
  'compare-previous'
) as HTMLButtonElement
const compareNext = document.getElementById(
  'compare-next'
) as HTMLButtonElement
const comparePosition = document.getElementById(
  'compare-position'
) as HTMLElement
const compareClose = document.getElementById(
  'compare-close'
) as HTMLButtonElement

let editor: JSONEditor | undefined
let baselineCompareEditor: JSONEditor | undefined
let currentCompareEditor: JSONEditor | undefined
let isCompareEnabled = true
let changedPaths = new Set<string>()
let changedPathList: string[][] = []
let currentDifferenceIndex = -1
let compareBaselineData: JsonValue = null
let compareCurrentData: JsonValue = null
let editorMode =
  savedState.mode && MODES.includes(savedState.mode) ? savedState.mode : 'tree'
let isReadOnly = savedState.readOnly ?? false
let currentUri: string | undefined
let currentFileName = ''
let lastRenderedText = ''
let changeTimer: number | undefined
let hasPendingChange = false
let bannerTimer: number | undefined
let suppressChange = false

window.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const message = event.data

  switch (message?.type) {
    case 'render':
      renderTree(message.json, message.text, message.fileName, message.uri)
      break
    case 'error':
      showDocumentError(
        message.message,
        message.fileName,
        message.text,
        message.uri
      )
      break
    case 'empty':
      showEmpty(message.message)
      break
    case 'saved':
      showBanner('已保存', 'info', 1600)
      break
  }
})

window.addEventListener(
  'keydown',
  (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault()
      event.stopPropagation()
      save()
    }
  },
  true
)

bannerClose.addEventListener('click', hideBanner)
diffForm.addEventListener('submit', (event) => {
  event.preventDefault()
  compareWithBaseline()
})
diffCancel.addEventListener('click', () => diffDialog.close())
diffBaseline.addEventListener('input', () => {
  diffError.hidden = true
})
compareToggle.addEventListener('click', toggleCompare)
comparePrevious.addEventListener('click', () => navigateDifference(-1))
compareNext.addEventListener('click', () => navigateDifference(1))
compareClose.addEventListener('click', () => diffDialog.close())
diffDialog.addEventListener('close', resetCompare)

vscode.postMessage({ type: 'ready' })

function renderTree(
  json: JsonValue,
  text: string,
  fileName: string,
  uri: string
): void {
  const switchedDocument = currentUri !== uri
  if (!switchedDocument && hasPendingChange) {
    flushPendingChange()
    return
  }

  if (switchedDocument) {
    flushPendingChange()
    currentUri = uri
  }

  try {
    hideState()

    if (!editor) {
      createEditor(editorMode, text, json, fileName)
      return
    }

    currentFileName = fileName
    suppressChange = true
    try {
      if (switchedDocument) {
        editor.set(json)
      } else {
        const mode = editor.getMode()
        if (mode === 'code' || mode === 'text' || mode === 'preview') {
          if (text !== editor.getText()) {
            editor.updateText(text)
          }
        } else {
          editor.update(json)
          resetTreePath(editor)
        }
      }
    } finally {
      suppressChange = false
    }

    editor.setName(fileName)
    lastRenderedText = text
    syncReadOnlyToggle()
  } catch (error) {
    showDocumentError(
      error instanceof Error ? error.message : String(error),
      fileName,
      text,
      uri
    )
  }
}

function createEditor(
  mode: JSONEditorMode,
  text: string,
  json: JsonValue | undefined,
  fileName: string
): void {
  destroyEditor()
  editorMode = mode
  currentFileName = fileName
  editor = new JSONEditor(editorElement, createOptions(mode))

  suppressChange = true
  try {
    if (mode === 'code' || mode === 'text' || mode === 'preview') {
      editor.setText(text)
    } else {
      editor.set(json ?? (JSON.parse(text) as JsonValue))
    }
    editor.setName(fileName)
  } finally {
    suppressChange = false
  }

  lastRenderedText = text
  setupSearchInput()
  syncReadOnlyToggle()
}

function createOptions(mode: JSONEditorMode): JSONEditorOptions {
  return {
    mode,
    modes: MODES,
    language: 'zh-CN',
    mainMenuBar: true,
    navigationBar: true,
    search: true,
    history: true,
    enableSort: false,
    enableTransform: false,
    onEditable: () => !isReadOnly,
    onCreateMenu: (menuItems) => (isReadOnly ? [] : menuItems),
    onChange: scheduleChange,
    onModeChange: (newMode) => {
      editorMode = newMode
      vscode.setState({ mode: newMode, readOnly: isReadOnly })
      hideBanner()
      window.setTimeout(() => {
        setupSearchInput()
        syncReadOnlyToggle()
      }, 0)
    },
    onEvent: (node, event) => {
      if (event.type !== 'click' || !currentUri) {
        return
      }

      vscode.postMessage({
        type: 'reveal',
        uri: currentUri,
        path: node.path
      })
    },
    onError: (error) => showBanner(error.message)
  }
}

function showDocumentError(
  message: string,
  fileName: string,
  text: string,
  uri: string
): void {
  const switchedDocument = currentUri !== uri
  if (switchedDocument) {
    flushPendingChange()
    currentUri = uri
  }

  currentFileName = fileName

  if (
    editor &&
    (editor.getMode() === 'code' || editor.getMode() === 'text')
  ) {
    suppressChange = true
    let loaded = false
    try {
      if (switchedDocument) {
        editor.setText(text)
      } else {
        editor.updateText(text)
      }
      lastRenderedText = text
      loaded = true
    } catch {
      // Fall through to the full error state if the text cannot be loaded.
    } finally {
      suppressChange = false
    }

    if (loaded) {
      showBanner(message)
      return
    }
  }

  destroyEditor()
  showState(
    fileName ? `无法显示 ${fileName}` : '无法显示 JSON',
    message
  )
}

function showEmpty(message: string): void {
  flushPendingChange()
  currentUri = undefined
  currentFileName = ''
  destroyEditor()
  showState('没有可显示的 JSON', message)
}

function showState(title: string, message: string): void {
  hideBanner()
  stateTitle.textContent = title
  stateMessage.textContent = message
  stateElement.hidden = false
}

function hideState(): void {
  stateElement.hidden = true
}

function destroyEditor(): void {
  clearPendingChange()
  editor?.destroy()
  editor = undefined
  editorElement.replaceChildren()
  lastRenderedText = ''
}

function setupSearchInput(): void {
  editorElement
    .querySelector<HTMLInputElement>('.jsoneditor-search input')
    ?.setAttribute('placeholder', '搜索')
}

function syncReadOnlyToggle(): void {
  editorElement.classList.toggle('jsoneditor-readonly', isReadOnly)

  const menu = editorElement.querySelector<HTMLElement>('.jsoneditor-menu')
  if (!menu) {
    return
  }

  let button = menu.querySelector<HTMLButtonElement>(
    '.jsoneditor-readonly-toggle'
  )

  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'jsoneditor-readonly-toggle'
    button.addEventListener('click', toggleReadOnly)
    menu.appendChild(button)
  }

  button.textContent = isReadOnly ? '只读' : '编辑'
  button.title = isReadOnly
    ? '当前为只读模式，点击切换到编辑模式'
    : '当前为编辑模式，点击切换到只读模式'
  button.classList.toggle('is-readonly', isReadOnly)

  let diffButton = menu.querySelector<HTMLButtonElement>(
    '.jsoneditor-diff-toggle'
  )

  if (!diffButton) {
    diffButton = document.createElement('button')
    diffButton.type = 'button'
    diffButton.className = 'jsoneditor-diff-toggle'
    diffButton.textContent = 'Diff'
    diffButton.title = '与粘贴的 JSON 比较'
    diffButton.addEventListener('click', () => {
      diffDialog.showModal()
      diffBaseline.focus()
    })
    menu.appendChild(diffButton)
  }
}

function compareWithBaseline(): void {
  try {
    const baselineText = diffBaseline.value.trim()
    if (!baselineText) {
      throw new Error('请粘贴用于比较的 JSON。')
    }

    const current = currentText() ?? lastRenderedText
    const baselineData = JSON.parse(baselineText) as JsonValue
    const currentData = JSON.parse(current) as JsonValue
    compareBaselineData = baselineData
    compareCurrentData = currentData
    changedPathList = []
    changedPaths = collectChangedPaths(baselineData, currentData)
    currentDifferenceIndex = -1
    isCompareEnabled = true
    diffForm.hidden = true
    compareView.hidden = false
    createCompareEditors(baselineData, currentData)
    syncCompareToggle()
    syncComparePosition()
    diffError.hidden = true
  } catch (error) {
    diffError.textContent = `无法比较 JSON：${
      error instanceof Error ? error.message : String(error)
    }`
    diffError.hidden = false
  }
}

function createCompareEditors(
  baseline: JsonValue,
  current: JsonValue
): void {
  destroyCompareEditors()
  const options = {
    mode: 'view' as const,
    modes: ['view' as const],
    mainMenuBar: true,
    navigationBar: true,
    search: true,
    history: false,
    enableSort: false,
    enableTransform: false,
    onClassName: ({ path }: { path: readonly string[] }) =>
      isCompareEnabled &&
      changedPaths.has(JSON.stringify(path.map(String)))
        ? 'jsoneditor-diff-changed'
        : undefined
  }

  baselineCompareEditor = new JSONEditor(compareBaselineElement, options)
  baselineCompareEditor.set(baseline)
  baselineCompareEditor.setName('基准 JSON')

  currentCompareEditor = new JSONEditor(compareCurrentElement, options)
  currentCompareEditor.set(current)
  currentCompareEditor.setName('当前 JSON')
}

function toggleCompare(): void {
  isCompareEnabled = !isCompareEnabled
  baselineCompareEditor?.refresh()
  currentCompareEditor?.refresh()
  syncCompareToggle()
}

function syncCompareToggle(): void {
  compareToggle.textContent = isCompareEnabled ? '差异：显示' : '差异：隐藏'
  compareToggle.setAttribute('aria-pressed', String(isCompareEnabled))
}

function syncComparePosition(): void {
  comparePosition.textContent = `0 / ${changedPathList.length}`
  comparePrevious.disabled = changedPathList.length === 0
  compareNext.disabled = changedPathList.length === 0
}

function navigateDifference(direction: -1 | 1): void {
  if (changedPathList.length === 0) {
    return
  }

  currentDifferenceIndex =
    currentDifferenceIndex < 0
      ? direction === 1
        ? 0
        : changedPathList.length - 1
      : (currentDifferenceIndex + direction + changedPathList.length) %
        changedPathList.length
  const path = changedPathList[currentDifferenceIndex]
  const baselinePath = findExistingPath(compareBaselineData, path)
  const currentPath = findExistingPath(compareCurrentData, path)
  baselineCompareEditor?.setSelection(
    { path: baselinePath },
    { path: baselinePath }
  )
  currentCompareEditor?.setSelection(
    { path: currentPath },
    { path: currentPath }
  )
  scrollSelectedDifference(compareBaselineElement)
  scrollSelectedDifference(compareCurrentElement)
  comparePosition.textContent = `${currentDifferenceIndex + 1} / ${changedPathList.length}`
}

function scrollSelectedDifference(editorElement: HTMLElement): void {
  const tree = editorElement.querySelector<HTMLElement>('.jsoneditor-tree')
  const selected = editorElement.querySelector<HTMLElement>('.jsoneditor-first')
  if (!tree || !selected) {
    return
  }

  const treeRect = tree.getBoundingClientRect()
  const selectedRect = selected.getBoundingClientRect()
  if (selectedRect.top < treeRect.top || selectedRect.bottom > treeRect.bottom) {
    tree.scrollTo({
      top:
        tree.scrollTop +
        selectedRect.top -
        treeRect.top -
        (treeRect.height - selectedRect.height) / 2,
      behavior: 'smooth'
    })
  }
}

function findExistingPath(root: JsonValue, path: readonly string[]): string[] {
  let value = root
  const existingPath: string[] = []

  for (const segment of path) {
    if (Array.isArray(value)) {
      const index = Number(segment)
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== segment
      ) {
        break
      }
      value = value[index]
    } else if (
      value !== null &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, segment)
    ) {
      value = value[segment]
    } else {
      break
    }
    existingPath.push(segment)
  }

  return existingPath
}

function collectChangedPaths(
  left: JsonValue,
  right: JsonValue,
  path: string[] = [],
  changed = new Set<string>()
): Set<string> {
  const markChanged = (changedPath: string[]): void => {
    const serializedPath = JSON.stringify(changedPath)
    if (!changed.has(serializedPath)) {
      changed.add(serializedPath)
      changedPathList.push(changedPath)
    }
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      markChanged(path)
      return changed
    }

    if (left.length !== right.length) {
      markChanged(path)
    }
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const childPath = [...path, String(index)]
      if (index >= left.length || index >= right.length) {
        markChanged(childPath)
      } else {
        collectChangedPaths(left[index], right[index], childPath, changed)
      }
    }
    return changed
  }

  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object'
  ) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    const keys = new Set([...leftKeys, ...rightKeys])
    const sameKeys =
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key))
    if (!sameKeys) {
      markChanged(path)
    }
    for (const key of keys) {
      const childPath = [...path, key]
      const leftHasKey = Object.prototype.hasOwnProperty.call(left, key)
      const rightHasKey = Object.prototype.hasOwnProperty.call(right, key)
      if (!leftHasKey || !rightHasKey) {
        markChanged(childPath)
      } else {
        collectChangedPaths(left[key], right[key], childPath, changed)
      }
    }
    return changed
  }

  if (left !== right) {
    markChanged(path)
  }
  return changed
}

function destroyCompareEditors(): void {
  baselineCompareEditor?.destroy()
  currentCompareEditor?.destroy()
  baselineCompareEditor = undefined
  currentCompareEditor = undefined
  compareBaselineElement.replaceChildren()
  compareCurrentElement.replaceChildren()
}

function resetCompare(): void {
  destroyCompareEditors()
  changedPaths.clear()
  changedPathList = []
  currentDifferenceIndex = -1
  syncComparePosition()
  compareBaselineData = null
  compareCurrentData = null
  compareView.hidden = true
  diffForm.hidden = false
  diffError.hidden = true
  diffBaseline.value = ''
}

function toggleReadOnly(): void {
  if (!editor) {
    return
  }

  flushPendingChange()
  const mode = editor.getMode()
  const text = currentText() ?? lastRenderedText
  const fileName = currentFileName

  isReadOnly = !isReadOnly
  vscode.setState({ mode, readOnly: isReadOnly })

  try {
    createEditor(mode, text, undefined, fileName)
    hideState()
  } catch (error) {
    showDocumentError(
      error instanceof Error ? error.message : String(error),
      fileName,
      text,
      currentUri ?? ''
    )
  }
}

function resetTreePath(target: JSONEditor): void {
  // jsoneditor keeps the previous breadcrumb path after update() even when the
  // selected field no longer exists. reset() clears just that path.
  const internals = target as JSONEditor & {
    treePath?: { reset(): void }
  }
  internals.treePath?.reset()
}

function scheduleChange(): void {
  if (suppressChange || isReadOnly) {
    return
  }

  if (changeTimer !== undefined) {
    window.clearTimeout(changeTimer)
  }

  hasPendingChange = true
  changeTimer = window.setTimeout(() => {
    changeTimer = undefined
    sendChange()
  }, 300)
}

function sendChange(): void {
  if (!currentUri || isReadOnly) {
    hasPendingChange = false
    return
  }

  const text = currentText()
  if (text === undefined || text === lastRenderedText) {
    hasPendingChange = false
    return
  }

  lastRenderedText = text
  hasPendingChange = false
  vscode.postMessage({ type: 'change', uri: currentUri, text })
}

function save(): void {
  if (!currentUri) {
    return
  }

  if (isReadOnly) {
    vscode.postMessage({ type: 'save', uri: currentUri })
    return
  }

  flushPendingChange()
  const text = currentText()
  if (text === undefined || text === lastRenderedText) {
    vscode.postMessage({ type: 'save', uri: currentUri })
    return
  }

  vscode.postMessage({ type: 'save', uri: currentUri, text })
}

function currentText(): string | undefined {
  if (!editor) {
    return undefined
  }

  try {
    const mode = editor.getMode()
    if (mode === 'code' || mode === 'text' || mode === 'preview') {
      return editor.getText()
    }
    return `${JSON.stringify(editor.get(), null, 2)}\n`
  } catch {
    return undefined
  }
}

function flushPendingChange(): void {
  if (changeTimer !== undefined) {
    window.clearTimeout(changeTimer)
    changeTimer = undefined
    sendChange()
  }
}

function clearPendingChange(): void {
  if (changeTimer !== undefined) {
    window.clearTimeout(changeTimer)
    changeTimer = undefined
  }
  hasPendingChange = false
}

function showBanner(
  message: string,
  kind: 'error' | 'info' = 'error',
  timeout = 0
): void {
  if (bannerTimer !== undefined) {
    window.clearTimeout(bannerTimer)
    bannerTimer = undefined
  }

  bannerMessage.textContent = message
  banner.dataset.kind = kind
  banner.hidden = false

  if (timeout > 0) {
    bannerTimer = window.setTimeout(hideBanner, timeout)
  }
}

function hideBanner(): void {
  if (bannerTimer !== undefined) {
    window.clearTimeout(bannerTimer)
    bannerTimer = undefined
  }
  banner.hidden = true
}
