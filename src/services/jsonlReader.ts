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
    const targetEndLine = targetStartLine + this.pageSize - 1;

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
        // 除非已经是文件末尾 (bytesRead < buffer.length 通常意味着 EOF，但也可能是部分读取，严谨做法是判断文件大小)
        const isEOF = (fileOffset + bytesRead) >= this.fileSize;
        leftovers = isEOF ? '' : lines.pop() || '';

        let chunkByteOffset = fileOffset; // 这个块的起始偏移

        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          const lineLength = Buffer.byteLength(raw); // 注意：这里简单计算，严谨需累加
          // 真正的偏移量计算比较复杂，因为 split 丢失了 \r\n 的具体字节。
          // 简便方法：我们只关心大概内容，或者重新扫描。
          // 为了高性能，我们这里假设是 \n 分隔。

          if (currentLineNum >= startLine) {
            // 解析
            result.push(this.parseLine(raw, currentLineNum, 0)); // 偏移量暂不精确计算以节省性能
          }

          currentLineNum++;
          // 如果已经读够了
          if (result.length >= count) break;
        }

        fileOffset += bytesRead;
        // 回退掉 leftovers 的长度，因为它们还没被消费
        fileOffset -= Buffer.byteLength(leftovers);
      }

      // 处理最后遗留的一行 (如果是 EOF)
      if (leftovers && result.length < count && currentLineNum >= startLine) {
        result.push(this.parseLine(leftovers, currentLineNum, 0));
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
      byteOffset: offset // 简化版暂不精确返回偏移
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