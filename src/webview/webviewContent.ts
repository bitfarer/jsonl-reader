import * as vscode from 'vscode';

/**
 * 生成 Webview HTML 内容
 * 使用 CSP 和外部资源链接，实现关注点分离
 */
export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // 创建指向 media 目录的 URI
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));

    // 生成随机 Nonce 用于安全性验证
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <title>JSONL Reader</title>
    <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
    <!-- Loading Overlay - 默认通过 CSS 隐藏 -->
    <div id="loadingOverlay" class="loading-overlay">
        <div class="loading-content">
            <div class="spinner"></div>
            <div class="loading-text" id="loadingText">Searching...</div>
            <button id="overlayCancelBtn" style="margin-top:16px">Cancel</button>
        </div>
    </div>

    <div id="indexProgressBar"></div>

    <div class="toolbar">
        <input type="text" id="searchInput" placeholder="Search..." style="width: 200px">
        <button id="searchBtn">Search</button>
        <button id="showErrorsBtn">Show Errors Only</button>
        <div style="flex:1"></div>
        <!-- 搜索模式按钮 - 初始隐藏 -->
        <button id="cancelSearchBtn" class="hidden">Cancel Search</button>
        <button id="backToFileBtn" class="hidden">← Back to File</button>
        <input type="number" id="gotoLine" placeholder="#" style="width: 60px">
        <button id="gotoBtn">Go</button>
        <div id="fileStatus">Initializing...</div>
    </div>

    <div class="main-container" id="container">
        <div style="padding:20px;text-align:center;opacity:0.6">Loading...</div>
    </div>

    <div class="pagination">
        <button id="prevBtn">Prev</button>
        <span>Page <input type="number" id="pageInput" value="1" style="width: 50px"> of <span id="totalPage">?</span></span>
        <button id="nextBtn">Next</button>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}