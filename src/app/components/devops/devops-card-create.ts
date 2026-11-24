// 0099: stub — substituído pelo F2 no Q1
import { MatDialog } from '@angular/material/dialog';

export interface DevOpsCardCreateOptions {
  epic?: number | null;
  team?: string | null;
  board?: string | null;
}

/** Diálogo "Novo card" do DevOps — a implementação real é do F2. Devolve o card criado (ou `undefined`). */
export async function openDevOpsCardCreate(_dialog: MatDialog, _options: DevOpsCardCreateOptions): Promise<{ id: number; title?: string } | undefined> {
  return undefined;
}
