import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CaseChatService } from '../../services/case-chat.service';
import { FileViewerDialogData, openFileViewer } from '../file-viewer/file-viewer-dialog.component';
import { CaseFile, SPECIALIST_NAME } from './case-chat.model';

/**
 * Abre um arquivo da conversa do especialista no visualizador rico (`app-file-viewer`), com ← → entre os arquivos da conversa
 * (menos os áudios, que tocam na própria mensagem) — em vez do `blob:` cru numa aba nova.
 */
export function openCaseFile(dialog: MatDialog, api: CaseChatService, card: string, files: readonly CaseFile[], file: CaseFile): void {
  const list = files.filter((x) => x.kind !== 'audio').slice().sort((a, b) => a.number - b.number);
  let i = list.findIndex((x) => x.id === file.id);
  if (i < 0) { list.unshift(file); i = 0; }
  const data = (f: CaseFile): FileViewerDialogData => ({
    name: f.name,
    contentType: f.contentType,
    kind: f.kind === 'file' ? null : f.kind,
    subtitle: `arquivo #${f.number} · ${f.fromSpecialist ? SPECIALIST_NAME : f.createdBy}`,
    icon: f.kind === 'image' ? 'image' : 'description',
    card,
    load: () => firstValueFrom(api.content(card, f))
  });
  openFileViewer(dialog, list.map(data), i);
}
