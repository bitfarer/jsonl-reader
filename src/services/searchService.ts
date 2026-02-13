import * as fs from 'fs';
import * as readline from 'readline';
import { SearchOptions, SearchResult, JsonlLine } from '../models/types';

/**
 * 搜索服务
 * 优化：使用 Async Iterator 和 setImmediate 实现非阻塞搜索，支持快速取消
 */
export class SearchService {
  private abortController: AbortController | null = null;
  private wasAborted: boolean = false;

  /**
   * 在文件中搜索
   */
  async search(
    filePath: string,
    options: SearchOptions,
    onProgress?: (current: number, total: number) => void,
    onResult?: (result: SearchResult) => void
  ): Promise<SearchResult[]> {
    // 1. 取消之前的搜索
    this.cancel();
    this.wasAborted = false;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const results: SearchResult[] = [];
    let lineNumber = 0;

    // 获取文件大小用于进度条
    let fileSize = 0;
    try {
      const stats = await fs.promises.stat(filePath);
      fileSize = stats.size;
    } catch (e) {
      console.error('Failed to get file stats', e);
    }

    // 2. 准备搜索匹配器
    const isErrorOnlyMode = options.showErrorOnly === true;
    const textMatcher = (options.query && options.query.trim())
      ? this.createTextMatcher(options)
      : null;

    // 如果不是找错误，且没有搜索词，直接返回
    if (!isErrorOnlyMode && !textMatcher) {
      return [];
    }

    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
      // 设置较大的 buffer 减少 IO 次数
      highWaterMark: 64 * 1024
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    try {
      let processedBytes = 0;

      // 3. 使用 for await 替代 on('line') 以便更好地控制流速和取消
      for await (const raw of rl) {
        // 检查取消信号
        if (signal.aborted) {
          this.wasAborted = true;
          break;
        }

        lineNumber++;
        // 估算字节进度 (readline 会吃掉换行符，所以这里只是估算)
        processedBytes += raw.length + 1;

        // 4. 关键优化：每 1000 行让出 CPU 时间片，允许事件循环处理 postMessage (如取消命令)
        if (lineNumber % 1000 === 0) {
          await new Promise(resolve => setImmediate(resolve));
          if (onProgress) {
            onProgress(processedBytes > fileSize ? fileSize : processedBytes, fileSize);
          }
        }

        const trimmedRaw = raw.trim();

        // 跳过空行
        if (!trimmedRaw) {
          continue;
        }

        let parsed: unknown = null;
        let parseError: string | undefined;

        try {
          parsed = JSON.parse(trimmedRaw);
        } catch (e) {
          parseError = e instanceof Error ? e.message : 'Invalid JSON';
        }

        // 判断是否匹配
        let shouldInclude = false;

        if (isErrorOnlyMode) {
          shouldInclude = parseError !== undefined;
        } else if (textMatcher) {
          shouldInclude = textMatcher(raw);
        }

        if (shouldInclude) {
          const line: JsonlLine = {
            lineNumber,
            raw,
            parsed,
            error: parseError,
            // 注意：在 readline 模式下很难获取精确的 byteOffset，
            // 但我们的 JsonlReader 是基于行号索引的，这里给 0 或估算值不影响跳转
            byteOffset: 0
          };

          const result: SearchResult = {
            line,
            matchValue: options.query || undefined
          };

          results.push(result);
          onResult?.(result); // 实时流式返回结果给前端（如果支持）

          if (results.length >= options.maxResults) {
            break;
          }
        }
      }
    } catch (err) {
      console.error('Search error:', err);
      throw err;
    } finally {
      // 确保流被销毁
      stream.destroy();
    }

    if (!this.wasAborted && onProgress) {
      onProgress(fileSize, fileSize);
    }

    return results;
  }

  /**
   * 创建文本匹配函数
   */
  private createTextMatcher(options: SearchOptions): (line: string) => boolean {
    const { query, caseSensitive, useRegex } = options;

    if (useRegex) {
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        return (line: string) => regex.test(line);
      } catch {
        // Fallback
      }
    }

    const searchQuery = caseSensitive ? query : query.toLowerCase();
    return (line: string) => {
      const searchLine = caseSensitive ? line : line.toLowerCase();
      return searchLine.includes(searchQuery);
    };
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  wasSearchAborted(): boolean {
    return this.wasAborted;
  }

  resetAbortState(): void {
    this.wasAborted = false;
  }
}

export const searchService = new SearchService();