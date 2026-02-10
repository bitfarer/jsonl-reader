import * as fs from 'fs';
import { SparseIndexEntry, FileStats } from '../models/types';

const INDEX_STRIDE = 1000; // 稀疏索引跨度：每1000行记录一次
const READ_BUFFER_SIZE = 64 * 1024; // 64KB 读取缓冲区

export class JsonlIndexer {
  // 缓存：filePath -> 稀疏索引数组
  private indices: Map<string, SparseIndexEntry[]> = new Map();
  // 缓存：filePath -> 总行数
  private totalLines: Map<string, number> = new Map();
  // 状态：正在索引的文件
  private activeJobs: Map<string, boolean> = new Map();

  /**
   * 启动后台索引构建 (非阻塞)
   */
  startIdx(
    filePath: string,
    onProgress: (stats: FileStats) => void
  ): void {
    if (this.activeJobs.get(filePath) || this.indices.has(filePath)) {
      return;
    }

    this.activeJobs.set(filePath, true);

    // 初始化第一个点
    this.indices.set(filePath, [{ line: 1, offset: 0 }]);

    this.runIndexingJob(filePath, onProgress).catch(err => {
      console.error('Indexing failed:', err);
      this.activeJobs.set(filePath, false);
    });
  }

  private async runIndexingJob(filePath: string, onProgress: (stats: FileStats) => void) {
    const fd = await fs.promises.open(filePath, 'r');
    const stats = await fd.stat();
    const fileSize = stats.size;
    const buffer = Buffer.alloc(READ_BUFFER_SIZE);

    let fileOffset = 0;
    let lineNumber = 1;
    let lastStoredLine = 1;
    let bufferOffset = 0;
    let bytesRead = 0;

    // 获取当前文件的索引引用
    const currentIndexes = this.indices.get(filePath)!;

    try {
      while (this.activeJobs.get(filePath)) {
        // 读取数据块
        const readResult = await fd.read(buffer, 0, READ_BUFFER_SIZE, fileOffset);
        bytesRead = readResult.bytesRead;

        if (bytesRead === 0) break; // EOF

        // 扫描换行符
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] === 10) { // \n
            lineNumber++;
            const currentTotalOffset = fileOffset + i + 1;

            // 每隔 INDEX_STRIDE 记录一次，或者记录最后一行
            if (lineNumber - lastStoredLine >= INDEX_STRIDE) {
              currentIndexes.push({
                line: lineNumber,
                offset: currentTotalOffset
              });
              lastStoredLine = lineNumber;

              // 报告进度 (不要太频繁，每增加一个索引点报告一次)
              onProgress({
                filePath,
                fileSize,
                scannedLines: lineNumber,
                progress: currentTotalOffset / fileSize,
                indexed: false
              });

              // *** 关键优化：让出 CPU 时间片 ***
              await new Promise(resolve => setImmediate(resolve));
            }
          }
        }

        fileOffset += bytesRead;

        // 如果已经读完了
        if (fileOffset >= fileSize) break;
      }

      // 记录结束状态
      this.totalLines.set(filePath, lineNumber);
      this.activeJobs.set(filePath, false);

      onProgress({
        filePath,
        fileSize,
        scannedLines: lineNumber,
        progress: 1,
        indexed: true
      });

    } finally {
      await fd.close();
    }
  }

  /**
   * 获取最近的索引检查点
   */
  getNearestOffset(filePath: string, targetLine: number): SparseIndexEntry {
    const list = this.indices.get(filePath);
    if (!list || list.length === 0) return { line: 1, offset: 0 };

    // 二分查找或简单的从后向前查找
    // 由于我们通常是顺序生成的，数组是有序的
    // 对于稀疏索引，我们找 <= targetLine 的最大值

    let low = 0;
    let high = list.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (list[mid].line === targetLine) {
        return list[mid];
      } else if (list[mid].line < targetLine) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // low 现在指向第一个 > targetLine 的位置，所以 low-1 是我们要找的
    const idx = Math.max(0, low - 1);
    return list[idx];
  }

  /**
   * 停止索引任务
   */
  stop(filePath: string) {
    this.activeJobs.set(filePath, false);
  }

  getTotalLines(filePath: string): number | undefined {
    return this.totalLines.get(filePath);
  }

  /**
   * 估算总行数（如果在索引过程中）
   */
  estimateTotalLines(filePath: string, fileSize: number): number {
    const known = this.totalLines.get(filePath);
    if (known) return known;

    const list = this.indices.get(filePath);
    if (!list || list.length <= 1) return 0;

    // 根据已扫描的平均行长估算
    const lastEntry = list[list.length - 1];
    const avgBytesPerLine = lastEntry.offset / lastEntry.line;
    return Math.floor(fileSize / avgBytesPerLine);
  }
}

export const jsonlIndexer = new JsonlIndexer();