import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
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
      totalPages: totalPages || 1,
      totalLines: safeTotalLines,
      pageSize: this.pageSize,
      isIndexed: exactTotal !== undefined
    };
  }

  /**
   * 从指定的 checkpoint 开始读取，直到获取到 neededCount 行数据
   * 优化：使用 StringDecoder 解决多字节字符跨 Buffer 截断导致的乱码/解析错误问题
   */
  private async readLinesFromOffset(
    checkpoint: SparseIndexEntry,
    startLine: number,
    count: number
  ): Promise<JsonlLine[]> {
    const fd = await fs.promises.open(this.filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024); // 增加 Buffer 到 64KB 减少 IO 次数
    const decoder = new StringDecoder('utf8'); // 关键：使用解码器处理多字节字符

    let currentLineNum = checkpoint.line;
    let fileOffset = checkpoint.offset;
    let leftovers = '';
    const result: JsonlLine[] = [];

    try {
      while (result.length < count) {
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, fileOffset);
        if (bytesRead === 0) break; // EOF

        // 关键修复：使用 decoder.write 而不是 buffer.toString
        // decoder 会自动缓存末尾不完整的字节，直到下一次 write 补全
        const textChunk = decoder.write(buffer.subarray(0, bytesRead));

        const chunk = leftovers + textChunk;
        const lines = chunk.split('\n');

        // 最后一部分可能是不完整的行，保留到下一次循环
        const isEOF = (fileOffset + bytesRead) >= this.fileSize;
        leftovers = isEOF ? '' : lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          let raw = lines[i];

          if (currentLineNum >= startLine) {
            // 处理 BOM
            if (currentLineNum === 1 && raw.charCodeAt(0) === 0xFEFF) {
              raw = raw.slice(1);
            }
            // 记录 parseLine
            result.push(this.parseLine(raw, currentLineNum, 0));
          }

          currentLineNum++;
          if (result.length >= count) break;
        }

        fileOffset += bytesRead;
        // 注意：这里的 fileOffset 只是物理读取偏移，用于下一次 read
        // 实际上因为 decoder 缓存了字节，逻辑上的字符偏移计算会比较复杂
        // 但既然我们依赖 split('\n') 和 leftovers，这种流式处理是安全的

        // 如果是 EOF，处理 decoder 中剩余的最后一点内容（虽然通常 write 已经处理了大部分）
        if (isEOF && leftovers === '' && lines.length === 0) {
          const final = decoder.end();
          if (final) {
            leftovers += final;
          }
        }
      }

      // 处理最后遗留的一行 (EOF)
      if (leftovers && result.length < count && currentLineNum >= startLine) {
        let raw = leftovers;
        // 再次确保最后可能存在的 BOM 或 decoder 尾部
        raw += decoder.end();

        if (currentLineNum === 1 && raw.charCodeAt(0) === 0xFEFF) {
          raw = raw.slice(1);
        }
        if (raw.trim()) {
          result.push(this.parseLine(raw, currentLineNum, 0));
        }
      }

    } finally {
      await fd.close();
    }

    return result;
  }

  private parseLine(raw: string, lineNumber: number, offset: number): JsonlLine {
    const cleanRaw = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    let parsed: unknown = null;
    let error: string | undefined;

    if (cleanRaw.trim()) {
      try {
        parsed = JSON.parse(cleanRaw);
      } catch (e) {
        // 只有当 JSON.parse 失败时才记录错误
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