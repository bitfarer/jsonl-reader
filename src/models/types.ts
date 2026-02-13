/**
 * 表示 JSONL 文件中的一行
 */
export interface JsonlLine {
  /** 行号（从1开始） */
  lineNumber: number;
  /** 原始 JSON 字符串 */
  raw: string;
  /** 解析后的对象（如果解析失败则为 null） */
  parsed: unknown;
  /** 解析错误信息 */
  error?: string;
  /** 该行在文件中的字节偏移量 */
  byteOffset: number;
}

/**
 * 稀疏索引节点 (每隔 N 行存一个)
 */
export interface SparseIndexEntry {
  line: number;      // 行号
  offset: number;    // 字节偏移量
}

/**
 * 分页数据
 */
export interface PageData {
  /** 当前页的行数据 */
  lines: JsonlLine[];
  /** 当前页码（从1开始） */
  currentPage: number;
  /** 估算或精确的总页数 */
  totalPages: number;
  /** 估算或精确的总行数 */
  totalLines: number;
  /** 每页行数 */
  pageSize: number;
  /** 索引是否完全构建完成 */
  isIndexed: boolean;
  /** (新增) 需要高亮并滚动的行号 */
  highlightLine?: number;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  /** 匹配的行 */
  line: JsonlLine;
  /** 匹配的字段路径 */
  matchPath?: string;
  /** 匹配的值 */
  matchValue?: string;
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 搜索查询 */
  query: string;
  /** 是否区分大小写 */
  caseSensitive: boolean;
  /** 是否使用正则表达式 */
  useRegex: boolean;
  /** 最大结果数 */
  maxResults: number;
  /** 是否只显示有error的行 */
  showErrorOnly?: boolean;
}

/**
 * 文件统计信息
 */
export interface FileStats {
  /** 文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 当前已扫描行数 */
  scannedLines: number;
  /** 索引进度 (0-1) */
  progress: number;
  /** 索引是否完成 */
  indexed: boolean;
}

/**
 * Webview 消息类型
 */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'requestPage'; page: number }
  | { type: 'gotoLine'; lineNumber: number }
  | { type: 'search'; options: SearchOptions }
  | { type: 'cancelSearch' }
  | { type: 'copyLine'; lineNumber: number };

/**
 * 扩展发送给 Webview 的消息
 */
export type ExtensionMessage =
  | { type: 'pageData'; data: PageData }
  | { type: 'fileStats'; stats: FileStats }
  | { type: 'searchResults'; results: SearchResult[]; query: string; interrupted?: boolean; isErrorOnly?: boolean }
  | { type: 'searchProgress'; current: number; total: number }
  | { type: 'error'; message: string }
  | { type: 'indexingProgress'; progress: number; totalLines: number };