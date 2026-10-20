import * as crypto from 'node:crypto'
import * as vscode from 'vscode'
import {
  JsonTreeSurface,
  getFileName,
  isJsonDocument
} from './JsonTreeSurface'

const OPEN_COMMAND = 'jsoneditor.open'
const PANEL_VIEW_TYPE = 'jsoneditor.treePanel'
const TREE_VIEW_ID = 'jsoneditor.treeView'

let panel: vscode.WebviewPanel | undefined
let panelSurface: JsonTreeSurface | undefined
let treeViewSurface: JsonTreeSurface | undefined
let treeView: vscode.WebviewView | undefined
let treeViewProvider: JsonTreeViewProvider | undefined

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  )
  statusBar.name = 'JSON Tree'
  statusBar.text = '$(json) JSON Tree'
  statusBar.tooltip = '在面板中打开当前 JSON 文件'
  statusBar.command = OPEN_COMMAND
  statusBar.show()

  treeViewProvider = new JsonTreeViewProvider(context.extensionUri)

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand(OPEN_COMMAND, () => openJsonTree(context)),
    vscode.window.registerWebviewViewProvider(
      TREE_VIEW_ID,
      treeViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      panelSurface?.syncFromDocument(event.document)
      treeViewSurface?.syncFromDocument(event.document)
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      panelSurface?.documentClosed(document.uri)
      treeViewSurface?.documentClosed(document.uri)
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (treeView?.visible) {
        treeViewProvider?.followActiveEditor(editor)
      }
    })
  )
}

export function deactivate(): void {
  panelSurface?.dispose()
  treeViewSurface?.dispose()
  panel?.dispose()
}

function openJsonTree(context: vscode.ExtensionContext): void {
  const document = vscode.window.activeTextEditor?.document

  if (!document) {
    void vscode.window.showWarningMessage('请先打开一个 JSON 文件。')
    return
  }

  if (!isJsonDocument(document)) {
    const name = getFileName(document)
    void vscode.window.showWarningMessage(
      `当前文件“${name}”不是 JSON 文件，请先打开 .json 文件。`
    )
    return
  }

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      'JSON Tree',
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
      }
    )
    panel.iconPath = vscode.Uri.joinPath(
      context.extensionUri,
      'media',
      'json-tree.svg'
    )
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri)

    const surface = new JsonTreeSurface(panel.webview)
    panelSurface = surface

    panel.webview.onDidReceiveMessage(
      (message: unknown) => surface.handleMessage(message),
      undefined,
      context.subscriptions
    )

    panel.onDidDispose(
      () => {
        surface.dispose()
        if (panelSurface === surface) {
          panelSurface = undefined
        }
        panel = undefined
      },
      undefined,
      context.subscriptions
    )
  }

  panel.title = `JSON: ${getFileName(document)}`
  panel.reveal(panel.viewColumn, true)
  panelSurface?.showDocument(document)
}

class JsonTreeViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    treeView = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist')
      ]
    }
    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this.extensionUri
    )

    const surface = new JsonTreeSurface(webviewView.webview)
    treeViewSurface = surface

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      surface.handleMessage(message)
    })

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.followActiveEditor(vscode.window.activeTextEditor)
      }
    })

    webviewView.onDidDispose(() => {
      surface.dispose()
      if (treeViewSurface === surface) {
        treeViewSurface = undefined
      }
      treeView = undefined
    })

    this.followActiveEditor(vscode.window.activeTextEditor)
  }

  followActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!treeViewSurface) {
      return
    }

    if (!editor) {
      treeViewSurface.showEmpty('请先打开一个 JSON 文件。')
      return
    }

    if (!isJsonDocument(editor.document)) {
      treeViewSurface.showEmpty(
        `当前文件“${getFileName(editor.document)}”不是 JSON 文件，请打开 .json 文件。`
      )
      return
    }

    treeViewSurface.showDocument(editor.document)
  }
}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = crypto.randomBytes(16).toString('hex')
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css')
  )
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>JSON Tree</title>
  </head>
  <body>
    <main id="editor" aria-label="JSON 编辑器"></main>
    <div id="banner" class="banner" role="alert" hidden>
      <span id="banner-message"></span>
      <button id="banner-close" type="button" title="关闭">&#10005;</button>
    </div>
    <section id="state" class="state" aria-live="polite" hidden>
      <div class="state-card">
        <div class="state-mark" aria-hidden="true">{ }</div>
        <h1 id="state-title">无法显示 JSON</h1>
        <p id="state-message"></p>
      </div>
    </section>
    <dialog id="diff-dialog" class="diff-dialog" aria-labelledby="diff-title">
      <form id="diff-form">
        <h2 id="diff-title">与基准 JSON 比较</h2>
        <label for="diff-baseline">粘贴基准 JSON</label>
        <textarea id="diff-baseline" spellcheck="false"></textarea>
        <p id="diff-error" class="diff-error" role="alert" hidden></p>
        <div class="diff-actions">
          <button id="diff-cancel" class="secondary" type="button">取消</button>
          <button type="submit">比较</button>
        </div>
      </form>
      <section id="compare-view" class="compare-view" hidden>
        <header class="compare-header">
          <h2>JSON Compare</h2>
          <nav class="compare-controls" aria-label="差异导航">
            <button id="compare-previous" type="button" title="上一个差异">
              上一个
            </button>
            <span id="compare-position" aria-live="polite">0 / 0</span>
            <button id="compare-next" type="button" title="下一个差异">
              下一个
            </button>
            <button id="compare-toggle" class="secondary" type="button">
              差异：显示
            </button>
            <button id="compare-close" type="button">关闭</button>
          </nav>
        </header>
        <div class="compare-panels">
          <section class="compare-panel">
            <h3>基准 JSON</h3>
            <div id="compare-baseline-editor"></div>
          </section>
          <section class="compare-panel">
            <h3>当前 JSON</h3>
            <div id="compare-current-editor"></div>
          </section>
        </div>
      </section>
    </dialog>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`
}
