# JSON Tree for VS Code

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中以交互式树形视图查看和编辑当前 JSON 文件。扩展使用
[jsoneditor](https://github.com/josdejong/jsoneditor)，并与 VS Code 文档保持同步。

## 功能

- 从 Activity Bar、状态栏或命令面板打开当前 JSON 文件。
- 在树形、代码、文本和预览模式间切换。
- 使用 jsoneditor 自带的搜索框查找 JSON 键和值。
- 点击 **Diff**，粘贴基准 JSON，在铺满 Webview 编辑区的 jsoneditor 双栏界面中比较，并使用上一个/下一个按钮跳转差异。
- 切换编辑和只读模式。
- 编辑内容会同步到 VS Code 文档；保存仍由 VS Code 管理。
- 点击树节点，在源码编辑器中定位并高亮对应位置。
- 多个 JSON Tree 视图与同一文档保持同步。
- 支持 VS Code 亮色、深色和高对比度主题。
- 为无效 JSON 显示解析错误；不支持 JSONC。

## 截图

| 亮色主题 | 深色主题 |
| --- | --- |
| ![亮色主题下的 JSON Tree](media/screenshot-light.png) | ![深色主题下的 JSON Tree](media/screenshot-dark.png) |

## 安装

从源码打包 VSIX：

```bash
pnpm install
pnpm package
```

`pnpm package` 会读取 `package.json` 中的当前版本号并在项目根目录生成 `.vsix`。
发布前运行 `pnpm package:release`，然后交互选择 patch、minor 或 major 版本递增类型。命令
使用 `bumpp` 更新版本号，再生成 VSIX，不会提交、打 tag 或推送到 Git；生成后请手动通过
Marketplace Publisher 门户上传。在 VS Code
扩展视图的 **...** 菜单中选择 **Install from VSIX...**，然后选择生成的文件。也可以使用
命令行安装：

```bash
code --install-extension ./jsoneditor-for-vscode-*.vsix
```

`package.json` 中的 `publisher` 必须与 Marketplace 的 Publisher ID 一致。上传前请先本地
安装并验证生成的 VSIX；Marketplace 中已发布的版本号不能重复使用。

## 使用

1. 打开一个标准 `.json` 文件。
2. 打开 Activity Bar 中的 **JSON Tree** 视图、点击状态栏中的 **JSON Tree**，
   或从命令面板运行 **JSON Editor: 打开 JSON 树形视图**。
3. 使用工具栏切换显示模式及编辑/只读状态。
4. 点击 **Diff**，粘贴基准 JSON，在铺满编辑区的 jsoneditor 双栏界面中比较；使用上一个/下一个按钮跳转差异。
5. 在编辑模式中修改后，按 macOS 的 `Cmd+S` 或 Windows/Linux 的 `Ctrl+S` 保存。

修改会立即同步到 VS Code 文档并标记为未保存；保存前不会写入磁盘。只读模式下，
保存命令仍可保存文档中已有的修改。

## 开发

项目使用 pnpm，需要 VS Code 1.90 或更高版本。

```bash
pnpm install
pnpm build
```

在 VS Code 中打开项目并按 `F5`，启动 Extension Development Host。也可以运行：

```bash
pnpm check     # TypeScript 类型检查和构建
pnpm package   # 生成 VSIX 安装包
```

在浏览器中打开 `test/preview.html` 可预览 Webview，无需启动 VS Code。使用
`?theme=dark`、`?theme=light`、`?error=1` 或 `?mode=code` 等查询参数预览不同状态。

## 贡献

欢迎提交问题反馈和改进建议。提交 Pull Request 前，请说明变更目的和验证方式，
并运行 `pnpm check`。涉及界面变化时，请附上截图。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。第三方依赖的声明和许可证见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 和 `third-party/`。
