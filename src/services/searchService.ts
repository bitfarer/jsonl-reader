import * as fs from 'fs';
import * as readline from 'readline';
import { SearchOptions, SearchResult, JsonlLine } from '../models/types';

/**
 * 搜索服务
 * 支持全文搜索、正则匹配
 */
export class SearchService {
  private abortController: AbortController | null = null;

  /**
   * 在文件中搜索
   */
  async search(
    filePath: string,
    options: SearchOptions,
    onProgress?: (current: number, total: number) => void,
    onResult?: (result: SearchResult) => void
  ): Promise<SearchResult[]> {
    // 取消之前的搜索
    this.cancel();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const results: SearchResult[] = [];
    let lineNumber = 0;
    let byteOffset = 0;

    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;

    const matcher = this.createMatcher(options);

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      const cleanup = () => {
        rl.close();
        stream.destroy();
      };

      signal.addEventListener('abort', () => {
        cleanup();
        resolve(results);
      });

      rl.on('line', (raw) => {
        if (signal.aborted) {
          return;
        }

        lineNumber++;
        const lineBytes = Buffer.byteLength(raw, 'utf-8');
        const currentOffset = byteOffset;
        byteOffset += lineBytes + 1;

        // 检查是否匹配
        const matchInfo = matcher(raw);
        if (matchInfo) {
          let parsed: unknown = null;
          let error: string | undefined;

          try {
            if (raw.trim()) {
              parsed = JSON.parse(raw);
            }
          } catch (e) {
            error = e instanceof Error ? e.message : 'Parse error';
          }

          const line: JsonlLine = {
            lineNumber,
            raw,
            parsed,
            error,
            byteOffset: currentOffset
          };

          const result: SearchResult = {
            line,
            matchPath: matchInfo.path,
            matchValue: matchInfo.value
          };

          results.push(result);
          onResult?.(result);

          // 达到最大结果数时停止
          if (results.length >= options.maxResults) {
            cleanup();
            resolve(results);
            return;
          }
        }

        // 报告进度
        if (onProgress && lineNumber % 500 === 0) {
          onProgress(byteOffset, fileSize);
        }
      });

      rl.on('close', () => {
        if (!signal.aborted) {
          onProgress?.(fileSize, fileSize);
          resolve(results);
        }
      });

      rl.on('error', reject);
      stream.on('error', reject);
    });
  }

  /**
   * 创建匹配函数
   */
  private createMatcher(
    options: SearchOptions
  ): (line: string) => { path?: string; value?: string } | null {
    const { query, caseSensitive, useRegex } = options;

    if (useRegex) {
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query, flags);
        return (line: string) => {
          const match = regex.exec(line);
          if (match) {
            return { value: match[0] };
          }
          return null;
        };
      } catch {
        // 无效的正则，降级为普通搜索
      }
    }

    // 普通文本搜索
    const searchQuery = caseSensitive ? query : query.toLowerCase();
    return (line: string) => {
      const searchLine = caseSensitive ? line : line.toLowerCase();
      if (searchLine.includes(searchQuery)) {
        return { value: query };
      }
      return null;
    };
  }

  /**
   * 在解析后的对象中深度搜索
   */
  searchInObject(
    obj: unknown,
    query: string,
    caseSensitive: boolean,
    path: string = ''
  ): { path: string; value: string }[] {
    const results: { path: string; value: string }[] = [];
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    const search = (value: unknown, currentPath: string) => {
      if (value === null || value === undefined) {
        return;
      }

      if (typeof value === 'string') {
        const searchValue = caseSensitive ? value : value.toLowerCase();
        if (searchValue.includes(searchQuery)) {
          results.push({ path: currentPath, value });
        }
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        const strValue = String(value);
        const searchValue = caseSensitive ? strValue : strValue.toLowerCase();
        if (searchValue.includes(searchQuery)) {
          results.push({ path: currentPath, value: strValue });
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          search(item, `${currentPath}[${index}]`);
        });
      } else if (typeof value === 'object') {
        Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
          const newPath = currentPath ? `${currentPath}.${key}` : key;
          search(val, newPath);
        });
      }
    };

    search(obj, path);
    return results;
  }

  /**
   * 取消搜索
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

// 单例导出
export const searchService = new SearchService();