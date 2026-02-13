import * as vscode from 'vscode';
import { JsonlReader } from '../services/jsonlReader';
import { searchService } from '../services/searchService';
import { getWebviewContent } from '../webview/webviewContent';
import { WebviewMessage, ExtensionMessage, SearchOptions } from '../models/types';

export class JsonlEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'jsonlReader.editor';
  private static readonly defaultPageSize = 50;

  constructor(private readonly context: vscode.ExtensionContext) { }

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new JsonlEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      JsonlEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    );
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => { } };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const filePath = document.uri.fsPath;
    const config = vscode.workspace.getConfiguration('jsonlReader');
    const pageSize = config.get<number>('pageSize', JsonlEditorProvider.defaultPageSize);

    const reader = new JsonlReader(filePath, pageSize);

    webviewPanel.webview.options = {
      enableScripts: true,
      // 允许 Webview 访问 media 目录
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    // 传入 extensionUri 以生成正确的资源路径
    webviewPanel.webview.html = getWebviewContent(webviewPanel.webview, this.context.extensionUri);

    const postMessage = (message: ExtensionMessage) => {
      webviewPanel.webview.postMessage(message);
    };

    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          switch (message.type) {
            case 'ready':
              const firstPage = await reader.readPage(1);
              postMessage({ type: 'pageData', data: firstPage });

              reader.initialize((stats) => {
                postMessage({
                  type: 'indexingProgress',
                  progress: stats.progress,
                  totalLines: stats.scannedLines
                });

                if (stats.indexed || stats.scannedLines % 5000 === 0) {
                  postMessage({ type: 'fileStats', stats });
                }
              });
              break;

            case 'requestPage':
              const pageData = await reader.readPage(message.page);
              postMessage({ type: 'pageData', data: pageData });
              break;

            case 'gotoLine':
              // 1. 计算页码
              const page = reader.getPageForLine(message.lineNumber);
              // 2. 读取该页数据
              const targetPageData = await reader.readPage(page);
              // 3. 注入 highlightLine 参数，告诉前端要高亮哪一行
              postMessage({
                type: 'pageData',
                data: {
                  ...targetPageData,
                  highlightLine: message.lineNumber
                }
              });
              break;

            case 'search':
              searchService.resetAbortState();
              await this.handleSearch(filePath, message.options, postMessage);
              break;

            case 'cancelSearch':
              searchService.cancel();
              break;

            case 'copyLine':
              const line = await reader.readLine(message.lineNumber);
              if (line) {
                const text = line.parsed ? JSON.stringify(line.parsed, null, 2) : line.raw;
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(`Line ${message.lineNumber} copied`);
              }
              break;
          }
        } catch (error) {
          postMessage({ type: 'error', message: String(error) });
        }
      },
      undefined,
      this.context.subscriptions
    );

    webviewPanel.onDidDispose(() => {
      reader.clearCache();
    });
  }

  private async handleSearch(
    filePath: string,
    options: SearchOptions,
    postMessage: (msg: ExtensionMessage) => void
  ): Promise<void> {
    const results = await searchService.search(
      filePath,
      options,
      (current, total) => {
        postMessage({ type: 'searchProgress', current, total });
      }
    );
    postMessage({
      type: 'searchResults',
      results,
      query: options.query,
      interrupted: searchService.wasSearchAborted(),
      isErrorOnly: options.showErrorOnly || false
    });
  }
}