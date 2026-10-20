import * as path from 'node:path'
import * as vscode from 'vscode'
import { parse as parseSourceMap, type Pointers } from 'json-source-map'

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'change'; uri: string; text: string }
  | { type: 'save'; uri: string; text?: string }
  | {
      type: 'reveal'
      uri: string
      path: Array<string | number>
    }

type OutgoingMessage =
  | {
      type: 'render'
      uri: string
      json: unknown
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

/**
 * One webview (editor panel or Activity Bar view) connected to one document.
 * The document is the source of truth; changes from the webview are applied
 * with a WorkspaceEdit so VS Code's dirty state and save flow keep working.
 */
export class JsonTreeSurface {
  private currentUri: string | undefined
  private emptyMessage = '请先打开一个 JSON 文件。'
  private lastSentText: string | undefined
  private postTimer: ReturnType<typeof setTimeout> | undefined
  private sourceMap:
    | {
        uri: string
        version: number
        bomOffset: number
        pointers: Pointers
      }
    | undefined
  private disposed = false

  constructor(private readonly webview: vscode.Webview) {}

  showDocument(document: vscode.TextDocument): void {
    this.currentUri = document.uri.toString()
    this.emptyMessage = '请先打开一个 JSON 文件。'
    this.postDocument(document)
  }

  showEmpty(message: string): void {
    this.currentUri = undefined
    this.emptyMessage = message
    void this.post({ type: 'empty', message })
  }

  syncFromDocument(document: vscode.TextDocument): void {
    if (this.disposed || document.uri.toString() !== this.currentUri) {
      return
    }

    if (document.getText() === this.lastSentText) {
      return
    }

    if (this.postTimer) {
      clearTimeout(this.postTimer)
    }

    this.postTimer = setTimeout(() => {
      this.postTimer = undefined
      if (!this.disposed && document.uri.toString() === this.currentUri) {
        this.postDocument(document)
      }
    }, 80)
  }

  documentClosed(uri: vscode.Uri): void {
    if (uri.toString() === this.currentUri) {
      this.showEmpty('文件已关闭，请重新打开一个 JSON 文件。')
    }
  }

  handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return
    }

    const data = message as Partial<IncomingMessage>
    switch (data.type) {
      case 'ready':
      case 'refresh':
        this.postCurrentDocument()
        break
      case 'change':
        if (typeof data.text === 'string' && typeof data.uri === 'string') {
          void this.applyText(data.uri, data.text)
        }
        break
      case 'save':
        if (typeof data.uri === 'string') {
          void this.applyAndSave(
            data.uri,
            typeof data.text === 'string' ? data.text : undefined
          )
        }
        break
      case 'reveal':
        if (typeof data.uri === 'string' && Array.isArray(data.path)) {
          void this.revealPath(data.uri, data.path)
        }
        break
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.postTimer) {
      clearTimeout(this.postTimer)
      this.postTimer = undefined
    }
  }

  private postCurrentDocument(): void {
    const document = this.findDocument()
    if (document) {
      this.postDocument(document)
    } else {
      void this.post({ type: 'empty', message: this.emptyMessage })
    }
  }

  private postDocument(document: vscode.TextDocument): void {
    if (this.disposed) {
      return
    }

    const text = document.getText()
    this.lastSentText = text
    const fileName = getFileName(document)

    try {
      const json = JSON.parse(
        text.replace(/^\uFEFF/, '')
      ) as unknown

      void this.post({
        type: 'render',
        uri: document.uri.toString(),
        json,
        text,
        fileName
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      void this.post({
        type: 'error',
        uri: document.uri.toString(),
        text,
        fileName,
        message: `JSON 解析失败：${detail}`
      })
    }
  }

  private findDocument(
    uri: string | undefined = this.currentUri
  ): vscode.TextDocument | undefined {
    if (!uri) {
      return undefined
    }

    return vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri
    )
  }

  private async applyText(
    uri: string,
    text: string
  ): Promise<vscode.TextDocument | undefined> {
    const document = this.findDocument(uri)
    if (!document) {
      void vscode.window.showWarningMessage(
        '文件已关闭，无法应用这次修改。'
      )
      return undefined
    }

    const isCurrentDocument = uri === this.currentUri

    if (document.getText() === text) {
      if (isCurrentDocument) {
        this.lastSentText = text
      }
      return document
    }

    // Set this before applying: the document change event fires while the edit
    // is being applied, and we do not want to echo it back into this webview.
    if (isCurrentDocument) {
      this.lastSentText = text
    }

    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      ),
      text
    )

    if (!(await vscode.workspace.applyEdit(edit))) {
      if (isCurrentDocument) {
        this.lastSentText = document.getText()
        this.postDocument(document)
      }
      void vscode.window.showWarningMessage(
        `无法修改文件“${getFileName(document)}”，它可能是只读的。`
      )
      return undefined
    }

    return document
  }

  private async revealPath(
    uri: string,
    path: Array<string | number>
  ): Promise<void> {
    const document = this.findDocument(uri)
    if (!document) {
      return
    }

    let sourceMap = this.sourceMap
    if (
      !sourceMap ||
      sourceMap.uri !== uri ||
      sourceMap.version !== document.version
    ) {
      const raw = document.getText()
      const bomOffset = raw.charCodeAt(0) === 0xfeff ? 1 : 0

      try {
        const parsed = parseSourceMap(
          bomOffset ? raw.slice(bomOffset) : raw
        )
        sourceMap = {
          uri,
          version: document.version,
          bomOffset,
          pointers: parsed.pointers
        }
        this.sourceMap = sourceMap
      } catch {
        return
      }
    }

    const pointer =
      sourceMap.pointers[toJsonPointer(path)]
    if (!pointer) {
      return
    }

    const offset = (pointer.key ?? pointer.value).pos + sourceMap.bomOffset
    const position = document.positionAt(offset)
    const line = document.lineAt(position.line)
    const selection = new vscode.Selection(line.range.start, line.range.end)

    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: true,
      selection
    })
    editor.revealRange(
      line.range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    )
  }

  private async applyAndSave(
    uri: string,
    text: string | undefined
  ): Promise<void> {
    const document = text === undefined
      ? this.findDocument(uri)
      : await this.applyText(uri, text)
    if (!document) {
      return
    }

    if (!(await document.save())) {
      void vscode.window.showWarningMessage(
        `保存文件“${getFileName(document)}”失败。`
      )
      return
    }

    void this.post({ type: 'saved' })
  }

  private post(message: OutgoingMessage): Thenable<boolean> {
    return this.webview.postMessage(message)
  }
}

export function isJsonDocument(document: vscode.TextDocument): boolean {
  return (
    document.languageId === 'json' ||
    path.extname(document.uri.path).toLowerCase() === '.json'
  )
}

export function getFileName(document: vscode.TextDocument): string {
  return path.basename(document.fileName || document.uri.path) || 'Untitled'
}

function toJsonPointer(path: Array<string | number>): string {
  return path
    .map(
      (segment) =>
        `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`
    )
    .join('')
}
