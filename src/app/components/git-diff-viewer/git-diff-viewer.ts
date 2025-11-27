// git-diff-viewer.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface DiffLine {
  type: 'addition' | 'deletion' | 'context' | 'info';
  lineNumber?: number;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface FileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

@Component({
  selector: 'app-git-diff-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="diff-container-wrapper">
      <div class="diff-container">
        @for (file of parsedFiles; track file.filename) {
          <div class="file-change mb-3">
            <!-- Cabeçalho do arquivo -->
            <div class="file-header">
              <div class="d-flex justify-content-between align-items-center">
                <div class="file-name">
                  <span class="badge" [ngClass]="getStatusBadgeClass(file.status)">
                    {{ file.status }}
                  </span>
                  <span class="ms-2">{{ file.filename }}</span>
                </div>
                <div class="file-stats">
                  <span class="additions">+{{ file.additions }}</span>
                  <span class="deletions ms-2">-{{ file.deletions }}</span>
                </div>
              </div>
            </div>

            <!-- Conteúdo do diff -->
            <div class="diff-content">
              <table class="diff-table">
                <tbody>
                  @for (line of file.lines; track $index) {
                    <tr [ngClass]="'line-' + line.type">
                      <td class="line-number old-line">
                        {{ line.oldLineNumber || '' }}
                      </td>
                      <td class="line-number new-line">
                        {{ line.newLineNumber || '' }}
                      </td>
                      <td class="line-content">
                        <span class="line-marker">{{ getLineMarker(line.type) }}</span>
                        <span class="line-text">{{ line.content }}</span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .diff-container-wrapper {
      max-height: 400px;
      overflow-y: auto;
      overflow-x: auto;
      border: 1px solid #30363d;
      border-radius: 6px;
      background-color: #0d1117;
    }

    .diff-container {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      color: #c9d1d9;
      min-width: fit-content;
      padding: 8px;
    }

    .file-change {
      border: 1px solid #30363d;
      border-radius: 6px;
      overflow: hidden;
      min-width: 800px;
    }

    .file-header {
      background-color: #161b22;
      padding: 12px 16px;
      border-bottom: 1px solid #30363d;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .file-name {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      word-break: break-all;
    }

    .badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .badge.modified {
      background-color: #9e6a03;
      color: #fff;
    }

    .badge.added {
      background-color: #238636;
      color: #fff;
    }

    .badge.deleted {
      background-color: #da3633;
      color: #fff;
    }

    .file-stats {
      font-size: 14px;
      white-space: nowrap;
    }

    .additions {
      color: #3fb950;
      font-weight: 600;
    }

    .deletions {
      color: #f85149;
      font-weight: 600;
    }

    .diff-content {
      overflow-x: visible;
      background-color: #0d1117;
    }

    .diff-table {
      width: 100%;
      border-collapse: collapse;
      background-color: #0d1117;
      table-layout: auto;
    }

    .diff-table tr {
      border-top: 1px solid #21262d;
    }

    .line-number {
      width: 50px;
      min-width: 50px;
      padding: 2px 10px;
      text-align: right;
      color: #6e7681;
      font-size: 12px;
      user-select: none;
      vertical-align: top;
      background-color: #0d1117;
      white-space: nowrap;
    }

    .old-line {
      border-right: 1px solid #21262d;
    }

    .new-line {
      border-right: 1px solid #21262d;
    }

    .line-content {
      padding: 2px 10px;
      white-space: pre;
      vertical-align: top;
      word-break: break-all;
      min-width: 0;
    }

    .line-marker {
      display: inline-block;
      width: 20px;
      user-select: none;
      flex-shrink: 0;
    }

    .line-text {
      white-space: pre;
      overflow-wrap: break-word;
    }

    .line-addition {
      background-color: rgba(63, 185, 80, 0.15);
    }

    .line-addition .line-number {
      background-color: rgba(63, 185, 80, 0.15);
    }

    .line-addition .line-marker {
      color: #3fb950;
    }

    .line-deletion {
      background-color: rgba(248, 81, 73, 0.15);
    }

    .line-deletion .line-number {
      background-color: rgba(248, 81, 73, 0.15);
    }

    .line-deletion .line-marker {
      color: #f85149;
    }

    .line-context {
      background-color: #0d1117;
    }

    .line-info {
      background-color: #161b22;
      color: #6e7681;
      font-style: italic;
    }

    .line-info .line-number {
      background-color: #161b22;
    }

    /* Customizar scrollbar */
    .diff-container-wrapper::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }

    .diff-container-wrapper::-webkit-scrollbar-track {
      background: #161b22;
      border-radius: 6px;
    }

    .diff-container-wrapper::-webkit-scrollbar-thumb {
      background: #30363d;
      border-radius: 6px;
    }

    .diff-container-wrapper::-webkit-scrollbar-thumb:hover {
      background: #484f58;
    }

    .diff-container-wrapper::-webkit-scrollbar-corner {
      background: #161b22;
    }
  `]
})
export class GitDiffViewerComponent {
  @Input() set commitData(data: any) {
    if (data) {
      this.parsedFiles = this.parseCommitData(data);
    }
  }

  parsedFiles: FileChange[] = [];

  private parseCommitData(data: any): FileChange[] {
    if (!data.files) return [];

    return data.files.map((file: any) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      lines: this.parsePatch(file.patch)
    }));
  }

  private parsePatch(patch: string): DiffLine[] {
    if (!patch) return [];

    const lines = patch.split('\n');
    const diffLines: DiffLine[] = [];
    let oldLineNumber = 0;
    let newLineNumber = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Linha de informação de contexto
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          oldLineNumber = parseInt(match[1], 10);
          newLineNumber = parseInt(match[2], 10);
        }
        diffLines.push({
          type: 'info',
          content: line
        });
      } else if (line.startsWith('+')) {
        diffLines.push({
          type: 'addition',
          content: line.substring(1),
          newLineNumber: newLineNumber++,
          oldLineNumber: undefined
        });
      } else if (line.startsWith('-')) {
        diffLines.push({
          type: 'deletion',
          content: line.substring(1),
          oldLineNumber: oldLineNumber++,
          newLineNumber: undefined
        });
      } else if (line.startsWith(' ')) {
        diffLines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNumber: oldLineNumber++,
          newLineNumber: newLineNumber++
        });
      }
    }

    return diffLines;
  }

  getStatusBadgeClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'modified': 'modified',
      'added': 'added',
      'deleted': 'deleted'
    };
    return statusMap[status] || 'modified';
  }

  getLineMarker(type: string): string {
    const markers: { [key: string]: string } = {
      'addition': '+',
      'deletion': '-',
      'context': ' ',
      'info': ''
    };
    return markers[type] || '';
  }
}
