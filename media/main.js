// @ts-check

// 通过这种方式获取 vscode API
// @ts-ignore
const vscode = acquireVsCodeApi();

let state = {
  page: 1,
  totalPages: 1,
  totalLines: 0,
  pageSize: 50,
  isIndexed: false,
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
};

// UI Interactions
els.prevBtn.onclick = () => changePage(state.page - 1);
els.nextBtn.onclick = () => changePage(state.page + 1);
els.pageInput.onchange = () => changePage(parseInt(els.pageInput.value));

els.gotoBtn.onclick = () => {
  const line = parseInt(els.gotoLine.value);
  if (line) vscode.postMessage({ type: "gotoLine", lineNumber: line });
};

els.gotoLine.onkeydown = (e) => {
  if (e.key === "Enter") els.gotoBtn.click();
};

// 搜索功能简单绑定
els.searchBtn.onclick = () => {
  const query = els.searchInput.value;
  if (query) {
    vscode.postMessage({
      type: "search",
      options: {
        query,
        caseSensitive: false,
        useRegex: false,
        maxResults: 100,
      },
    });
  }
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

function changePage(p) {
  if (p < 1 || p > state.totalPages) return;
  els.container.innerHTML =
    '<div style="padding:20px;text-align:center">Loading page ' +
    p +
    "...</div>";
  vscode.postMessage({ type: "requestPage", page: p });
}

function syntaxHighlight(json) {
  if (typeof json !== "string") json = JSON.stringify(json, undefined, 2);
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

function renderLines(lines) {
  els.container.innerHTML = lines
    .map((line) => {
      const preview =
        line.raw.length > 200 ? line.raw.slice(0, 200) + "..." : line.raw;
      const formatted = line.parsed ? syntaxHighlight(line.parsed) : line.raw;
      const err = line.error
        ? '<span style="color:red">[JSON Error]</span> '
        : "";

      return `
        <div class="line-item" id="line-${line.lineNumber}">
            <div class="line-header">
                <span class="expand-icon">▶</span>
                <span class="line-num">${line.lineNumber}</span>
                <span class="line-prev">${err}${preview.replace(/</g, "&lt;")}</span>
                <button class="copy-btn" title="Copy raw JSON">📋</button>
            </div>
            <div class="line-content">${formatted}</div>
        </div>`;
    })
    .join("");

  els.container.scrollTop = 0;
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

function updatePaginationUI(currentTotalLines, isIndexed) {
  state.totalLines = currentTotalLines;
  state.isIndexed = isIndexed;

  const newTotalPages = Math.ceil(state.totalLines / state.pageSize) || 1;
  state.totalPages = newTotalPages;

  els.totalPage.innerText = isIndexed ? newTotalPages : newTotalPages + "+";

  els.prevBtn.disabled = state.page <= 1;
  els.nextBtn.disabled = isIndexed && state.page >= state.totalPages;
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "pageData":
      const data = msg.data;
      state.page = data.currentPage;
      state.pageSize = data.pageSize;

      renderLines(data.lines);
      updatePaginationUI(data.totalLines, data.isIndexed);
      els.pageInput.value = state.page;

      if (data.highlightLine) {
        setTimeout(() => scrollToLine(data.highlightLine), 50);
      }
      break;

    case "indexingProgress":
      const pct = Math.round(msg.progress * 100);
      els.progressBar.style.width = pct + "%";
      els.fileStatus.innerText = `Indexing: ${pct}% (${msg.totalLines} lines found)`;

      updatePaginationUI(msg.totalLines, false);

      if (pct >= 100) {
        setTimeout(() => (els.progressBar.style.display = "none"), 1000);
        els.fileStatus.innerText = `Ready (${msg.totalLines} lines)`;
      }
      break;

    case "fileStats":
      els.fileStatus.innerText = `${msg.stats.indexed ? "Ready" : "Indexing..."} (${msg.stats.scannedLines} lines)`;
      updatePaginationUI(msg.stats.scannedLines, msg.stats.indexed);
      break;
  }
});

vscode.postMessage({ type: "ready" });
