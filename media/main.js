// @ts-check

// 通过这种方式获取 vscode API
// @ts-ignore
const vscode = acquireVsCodeApi();

const state = {
  page: 1,
  totalPages: 1,
  totalLines: 0,
  pageSize: 50,
  isIndexed: false,
  mode: 'browse', // 'browse' | 'search'
  searchResults: [],
  searchQuery: '',
  isErrorOnlySearch: false,
  wasInterrupted: false,
};

const els = {
  container: document.getElementById("container"),
  pageInput: document.getElementById("pageInput"),
  totalPage: document.getElementById("totalPage"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  progressBar: document.getElementById("indexProgressBar"),
  fileStatus: document.getElementById("fileStatus"),
  gotoBtn: document.getElementById("gotoBtn"),
  gotoLine: document.getElementById("gotoLine"),
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  showErrorsBtn: document.getElementById("showErrorsBtn"),
  cancelSearchBtn: document.getElementById("cancelSearchBtn"),
  backToFileBtn: document.getElementById("backToFileBtn"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  overlayCancelBtn: document.getElementById("overlayCancelBtn"),
};

// ============ UI 控制函数 ============

function setVisible(el, show) {
  if (!el) { return; }
  if (show) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function showLoading(text) {
  els.loadingText.innerText = text;
  els.loadingOverlay.classList.add('visible');
  els.searchBtn.disabled = true;
  els.showErrorsBtn.disabled = true;
  setVisible(els.cancelSearchBtn, true);
  setVisible(els.backToFileBtn, false);
}

function hideLoading() {
  els.loadingOverlay.classList.remove('visible');
  els.searchBtn.disabled = false;
  els.showErrorsBtn.disabled = false;
  setVisible(els.cancelSearchBtn, false);
  updateToolbar();
}

function updateToolbar() {
  const isSearchMode = state.mode === "search";

  setVisible(els.searchBtn, !isSearchMode);
  setVisible(els.showErrorsBtn, !isSearchMode);
  setVisible(els.prevBtn, !isSearchMode);
  setVisible(els.nextBtn, !isSearchMode);
  setVisible(els.pageInput, !isSearchMode);
  setVisible(els.totalPage, !isSearchMode);
  setVisible(els.backToFileBtn, isSearchMode);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ============ 搜索相关 ============

function startSearch(query, isErrorOnly = false) {
  state.mode = "search";
  state.searchQuery = query;
  state.isErrorOnlySearch = isErrorOnly;
  state.searchResults = [];
  state.wasInterrupted = false;

  // 清除旧状态，避免混淆
  els.fileStatus.innerText = "Searching...";

  const loadingMsg = isErrorOnly
    ? "Searching for JSON parse errors..."
    : `Searching for "${query}"...`;

  showLoading(loadingMsg);

  vscode.postMessage({
    type: "search",
    options: {
      query: query,
      caseSensitive: false,
      useRegex: false,
      maxResults: 1000,
      showErrorOnly: isErrorOnly,
    },
  });
}

function cancelSearch() {
  // 立即给用户反馈
  els.loadingText.innerText = "Cancelling...";
  vscode.postMessage({ type: "cancelSearch" });
  // 不必等待后端返回，后端收到消息后的 searchResults 消息会处理关闭 loading
}

function backToBrowseMode() {
  state.mode = "browse";
  state.searchResults = [];
  state.searchQuery = "";
  state.isErrorOnlySearch = false;
  state.wasInterrupted = false;

  // 修复：返回浏览模式时重置状态文本
  els.fileStatus.innerText = "Ready";

  updateToolbar();
  // 重新加载当前页以刷新视图
  changePage(state.page);
}

// ============ 分页相关 ============

function changePage(p) {
  if (p < 1 || (state.isIndexed && p > state.totalPages)) { return; }
  els.container.innerHTML =
    '<div style="padding:20px;text-align:center;opacity:0.6">Loading page ' +
    p + "...</div>";
  vscode.postMessage({ type: "requestPage", page: p });
}

function updatePaginationUI(currentTotalLines, isIndexed) {
  state.totalLines = currentTotalLines;
  state.isIndexed = isIndexed;

  const newTotalPages = Math.ceil(state.totalLines / state.pageSize) || 1;
  state.totalPages = newTotalPages;

  els.totalPage.innerText = isIndexed ? String(newTotalPages) : newTotalPages + "+";

  els.prevBtn.disabled = state.page <= 1;
  els.nextBtn.disabled = isIndexed && state.page >= state.totalPages;
}

// ============ 渲染相关 ============

function syntaxHighlight(json) {
  if (typeof json !== "string") { json = JSON.stringify(json, undefined, 2); }
  json = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function (match) {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      }
      return '<span class="' + cls + '">' + match + "</span>";
    },
  );
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderLines(lines) {
  if (!lines || lines.length === 0) {
    els.container.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6">No data to display</div>';
    return;
  }

  els.container.innerHTML = lines
    .map((line) => {
      const preview =
        line.raw.length > 200 ? line.raw.slice(0, 200) + "..." : line.raw;
      const formatted = line.parsed ? syntaxHighlight(line.parsed) : escapeHtml(line.raw);
      const errorBadge = line.error
        ? `<span class="error-badge" title="${escapeHtml(line.error)}">⚠️ Error</span> `
        : "";
      const errorClass = line.error ? "error" : "";
      const errorDetail = line.error
        ? `<div class="error-detail">❌ ${escapeHtml(line.error)}</div>`
        : "";

      return `
        <div class="line-item ${errorClass}" id="line-${line.lineNumber}">
            <div class="line-header">
                <span class="expand-icon">▶</span>
                <span class="line-num">${line.lineNumber}</span>
                <span class="line-prev">${errorBadge}${escapeHtml(preview)}</span>
                <button class="copy-btn" title="Copy raw JSON">📋</button>
            </div>
            <div class="line-content">${formatted}${errorDetail}</div>
        </div>`;
    })
    .join("");

  els.container.scrollTop = 0;
}

function renderEmptyState(message) {
  els.container.innerHTML = `<div style="padding:40px;text-align:center;opacity:0.6">${escapeHtml(message)}</div>`;
}

function scrollToLine(lineNumber) {
  const el = document.getElementById("line-" + lineNumber);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    document
      .querySelectorAll(".highlight-flash")
      .forEach((e) => e.classList.remove("highlight-flash"));
    el.classList.add("highlight-flash");
    if (!el.classList.contains("expanded")) {
      el.classList.add("expanded");
    }
  }
}

// ============ 事件绑定 ============

els.prevBtn.onclick = () => changePage(state.page - 1);
els.nextBtn.onclick = () => changePage(state.page + 1);
els.pageInput.onchange = () => changePage(parseInt(els.pageInput.value));

els.gotoBtn.onclick = () => {
  const line = parseInt(els.gotoLine.value);
  if (line && line > 0) {
    vscode.postMessage({ type: "gotoLine", lineNumber: line });
  }
};

els.gotoLine.onkeydown = (e) => {
  if (e.key === "Enter") { els.gotoBtn.click(); }
};

els.searchBtn.onclick = () => {
  const query = els.searchInput.value.trim();
  if (query) {
    startSearch(query, false);
  }
};

els.searchInput.onkeydown = (e) => {
  if (e.key === "Enter") { els.searchBtn.click(); }
};

els.showErrorsBtn.onclick = () => {
  startSearch("", true);
};

// 绑定取消按钮
els.cancelSearchBtn.onclick = cancelSearch;
els.overlayCancelBtn.onclick = cancelSearch;

els.backToFileBtn.onclick = () => {
  backToBrowseMode();
};

els.container.addEventListener("click", (e) => {
  const copyBtn = e.target.closest(".copy-btn");
  if (copyBtn) {
    e.stopPropagation();
    const lineItem = copyBtn.closest(".line-item");
    const lineNum = parseInt(lineItem.id.replace("line-", ""));
    vscode.postMessage({ type: "copyLine", lineNumber: lineNum });

    const originalText = copyBtn.innerText;
    copyBtn.innerText = "✅";
    setTimeout(() => (copyBtn.innerText = originalText), 1000);
    return;
  }

  const header = e.target.closest(".line-header");
  if (header) {
    const lineItem = header.closest(".line-item");
    lineItem.classList.toggle("expanded");
  }
});

// ============ 消息处理 ============

window.addEventListener("message", (event) => {
  const msg = event.data;

  switch (msg.type) {
    case "pageData": {
      const data = msg.data;
      state.page = data.currentPage;
      state.pageSize = data.pageSize;

      renderLines(data.lines);
      updatePaginationUI(data.totalLines, data.isIndexed);
      els.pageInput.value = state.page;

      // 恢复浏览模式状态
      if (state.mode === 'browse') {
        els.fileStatus.innerText = data.isIndexed ? `Ready (${data.totalLines} lines)` : "Indexing...";
      }

      if (data.highlightLine) {
        setTimeout(() => scrollToLine(data.highlightLine), 50);
      }
      break;
    }

    case "indexingProgress": {
      const pct = Math.round(msg.progress * 100);
      els.progressBar.style.width = pct + "%";

      if (state.mode === 'browse') {
        els.fileStatus.innerText = `Indexing: ${pct}% (${msg.totalLines} lines found)`;
      }

      updatePaginationUI(msg.totalLines, false);

      if (pct >= 100) {
        setTimeout(() => (els.progressBar.style.display = "none"), 1000);
        if (state.mode === 'browse') {
          els.fileStatus.innerText = `Ready (${msg.totalLines} lines)`;
        }
      }
      break;
    }

    case "fileStats": {
      if (state.mode === 'browse') {
        els.fileStatus.innerText = `${msg.stats.indexed ? "Ready" : "Indexing..."} (${msg.stats.scannedLines} lines)`;
      }
      updatePaginationUI(msg.stats.scannedLines, msg.stats.indexed);
      break;
    }

    case "searchResults": {
      hideLoading();

      const results = msg.results || [];
      const count = results.length;
      const interrupted = msg.interrupted || false;
      const isErrorOnly = msg.isErrorOnly || state.isErrorOnlySearch;

      state.searchResults = results;
      state.wasInterrupted = interrupted;

      if (count > 0) {
        const lines = results.map((r) => r.line);
        const interruptedSuffix = interrupted ? " (Canceled)" : "";
        const typeLabel = isErrorOnly ? "error lines" : "results";
        els.fileStatus.innerText = `Found ${count} ${typeLabel}${interruptedSuffix}`;

        if (interrupted) {
          showToast("Search canceled");
        }
        renderLines(lines);
      } else {
        const noResultMsg = interrupted
          ? "Search canceled"
          : (isErrorOnly ? "No JSON parse errors found" : `No results found for "${msg.query}"`);

        els.fileStatus.innerText = interrupted ? "Canceled" : "No results";
        renderEmptyState(noResultMsg);
      }
      break;
    }

    case "searchProgress": {
      if (els.loadingOverlay.classList.contains('visible')) {
        const progressText = msg.total > 0
          ? `Scanning... ${Math.round((msg.current / msg.total) * 100)}%`
          : "Scanning...";
        els.loadingText.innerText = progressText;
      }
      break;
    }

    case "error": {
      hideLoading();
      showToast("Error: " + msg.message);
      console.error("Extension error:", msg.message);
      break;
    }
  }
});

// ============ 初始化 ============

updateToolbar();
vscode.postMessage({ type: "ready" });