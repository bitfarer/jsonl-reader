import * as fs from 'fs';
import { JsonlLine, PageData, SparseIndexEntry } from '../models/types';
import { jsonlIndexer } from './jsonlIndexer';

export class JsonlReader {
  private filePath: string;
  private pageSize: number;
  private fileSize: number = 0;

  constructor(filePath: string, pageSize: number = 100) {
    this.filePath = filePath;
    this.pageSize = pageSize;
    try {
      this.fileSize = fs.statSync(filePath).size;
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * 启动后台索引，立即返回
   */
  initialize(onProgress: (stats: any) => void): void {
    jsonlIndexer.startIdx(this.filePath, onProgress);
  }

  /**
   * 读取分页数据
   */
  async readPage(page: number): Promise<PageData> {
    const targetStartLine = (page - 1) * this.pageSize + 1;
    // 1. 获取起始位置的近似值
    const checkpoint = jsonlIndexer.getNearestOffset(this.filePath, targetStartLine);

    // 2. 从 checkpoint 开始读取并精确定位
    const lines = await this.readLinesFromOffset(checkpoint, targetStartLine, this.pageSize);

    // 3. 获取或估算总行数
    const exactTotal = jsonlIndexer.getTotalLines(this.filePath);
    const totalLines = exactTotal ?? jsonlIndexer.estimateTotalLines(this.filePath, this.fileSize);

    // 避免除零
    const safeTotalLines = totalLines || 1;
    const totalPages = Math.ceil(safeTotalLines / this.pageSize);

    return {
      lines,
      currentPage: page,
      totalPages: totalPages || 1, // 至少显示1页
      totalLines: safeTotalLines,
      pageSize: this.pageSize,
      isIndexed: exactTotal !== undefined
    };
  }

  /**
   * 从指定的 checkpoint 开始读取，直到获取到 neededCount 行数据
   */
  private async readLinesFromOffset(
    checkpoint: SparseIndexEntry,
    startLine: number,
    count: number
  ): Promise<JsonlLine[]> {
    const fd = await fs.promises.open(this.filePath, 'r');
    const buffer = Buffer.alloc(16 * 1024); // 16KB window

    let currentLineNum = checkpoint.line;
    let fileOffset = checkpoint.offset;
    let leftovers = '';
    const result: JsonlLine[] = [];

    try {
      while (result.length < count) {
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, fileOffset);
        if (bytesRead === 0) break; // EOF

        const chunk = leftovers + buffer.toString('utf-8', 0, bytesRead);
        const lines = chunk.split('\n');

        // 最后一部分可能是不完整的行，保留到下一次循环
        const isEOF = (fileOffset + bytesRead) >= this.fileSize;
        leftovers = isEOF ? '' : lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          let raw = lines[i];

          if (currentLineNum >= startLine) {
            // 处理 BOM (仅在文件开头可能出现)
            if (currentLineNum === 1 && raw.charCodeAt(0) === 0xFEFF) {
              raw = raw.slice(1);
            }

            result.push(this.parseLine(raw, currentLineNum, 0));
          }

          currentLineNum++;
          if (result.length >= count) break;
        }

        fileOffset += bytesRead;
        // 回退掉 leftovers 的长度
        fileOffset -= Buffer.byteLength(leftovers);
      }

      // 处理最后遗留的一行 (如果是 EOF)
      if (leftovers && result.length < count && currentLineNum >= startLine) {
        let raw = leftovers;
        if (currentLineNum === 1 && raw.charCodeAt(0) === 0xFEFF) {
          raw = raw.slice(1);
        }
        result.push(this.parseLine(raw, currentLineNum, 0));
      }

    } finally {
      await fd.close();
    }

    return result;
  }

  private parseLine(raw: string, lineNumber: number, offset: number): JsonlLine {
    // 移除回车符，处理 Windows 换行
    const cleanRaw = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    let parsed: unknown = null;
    let error: string | undefined;

    // 优化：与 SearchService 保持一致，使用 trim() 
    if (cleanRaw.trim()) {
      try {
        parsed = JSON.parse(cleanRaw);
      } catch (e) {
        error = e instanceof Error ? e.message : 'Invalid JSON';
      }
    }

    return {
      lineNumber,
      raw: cleanRaw,
      parsed,
      error,
      byteOffset: offset
    };
  }

  async readLine(lineNumber: number): Promise<JsonlLine | null> {
    const checkpoint = jsonlIndexer.getNearestOffset(this.filePath, lineNumber);
    const lines = await this.readLinesFromOffset(checkpoint, lineNumber, 1);
    return lines[0] || null;
  }

  getPageForLine(lineNumber: number): number {
    return Math.ceil(lineNumber / this.pageSize);
  }

  clearCache() {
    jsonlIndexer.stop(this.filePath);
  }
}