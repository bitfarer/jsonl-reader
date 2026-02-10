import * as vscode from 'vscode';
import { JsonlEditorProvider } from './providers/jsonlEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('JSONL Reader extension is now active');

  // 注册自定义编辑器
  context.subscriptions.push(
    JsonlEditorProvider.register(context)
  );

  // 注册打开文件命令（从命令面板）
  context.subscriptions.push(
    vscode.commands.registerCommand('jsonlReader.openFile', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'JSONL Files': ['jsonl', 'ndjson'],
          'All Files': ['*']
        }
      });

      if (uris && uris.length > 0) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uris[0],
          JsonlEditorProvider.viewType
        );
      }
    })
  );

  // 注册右键菜单命令
  context.subscriptions.push(
    vscode.commands.registerCommand('jsonlReader.openWithReader', async (uri: vscode.Uri) => {
      if (uri) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri,
          JsonlEditorProvider.viewType
        );
      }
    })
  );

  // 自动配置默认编辑器（可选）
  const config = vscode.workspace.getConfiguration('jsonlReader');
  if (config.get<boolean>('useAsDefault', true)) {
    setDefaultEditor();
  }
}

/**
 * 设置为默认编辑器
 */
async function setDefaultEditor() {
  const config = vscode.workspace.getConfiguration('workbench');
  const associations = config.get<Record<string, string>>('editorAssociations') || {};

  let needsUpdate = false;

  if (associations['*.jsonl'] !== 'jsonlReader.editor') {
    associations['*.jsonl'] = 'jsonlReader.editor';
    needsUpdate = true;
  }

  if (associations['*.ndjson'] !== 'jsonlReader.editor') {
    associations['*.ndjson'] = 'jsonlReader.editor';
    needsUpdate = true;
  }

  if (needsUpdate) {
    await config.update('editorAssociations', associations, vscode.ConfigurationTarget.Global);
  }
}

export function deactivate() {
  // 清理
}