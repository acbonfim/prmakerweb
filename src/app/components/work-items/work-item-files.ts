/**
 * 0085 rodada 5 (1.2): arquivos de um item de trabalho — só os dele (`GET WorkItems/{number}/files`): os gravados no
 * item (`source: 'item'`) e os do plano ligado (`source: 'plan'`, conteúdo pelo `contentUrl` relativo). Funções puras
 * (agrupamento, rótulos, prévia) — testadas em `work-item-files.spec.ts`.
 */

export type WorkItemFileKind = 'script' | 'analysis' | 'ticket' | 'data' | 'attachment' | 'text';
export type WorkItemFileSource = 'item' | 'plan';

export interface WorkItemFile {
  id: string;
  /** Número do arquivo no item (quando o servidor numera). */
  number?: number | null;
  name: string;
  kind: WorkItemFileKind;
  contentType?: string | null;
  size?: number | null;
  createdAt?: string | null;
  /** Sub-tarefa que gerou o arquivo. */
  taskNumber?: number | null;
  source?: WorkItemFileSource | null;
  /** Caminho do conteúdo (relativo à API) — obrigatório para os do plano. */
  contentUrl?: string | null;
  description?: string | null;
  workItemNumber?: number | null;
  /** Plano de origem (`source: 'plan'`). */
  planId?: string | null;
  stepKey?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
}

/** Resultado da lista: `unavailable` = servidor sem o endpoint (404) — a tela mostra um aviso discreto. */
export interface WorkItemFilesResult {
  files: WorkItemFile[];
  unavailable: boolean;
}

/** `POST WorkItems/{number}/files` em JSON (texto gerado — chamado, script, análise). */
export interface CreateWorkItemTextFileRequest {
  name: string;
  kind: WorkItemFileKind;
  content: string;
  taskNumber?: number | null;
}

export interface FileKindLook {
  kind: WorkItemFileKind;
  /** Grupo (plural) — título da seção. */
  group: string;
  /** Um arquivo (singular). */
  label: string;
  icon: string;
  color: string;
}

/** Ordem dos grupos: o chamado primeiro (é o que a pessoa copia para o sistema de chamados). */
export const FILE_KIND_LOOKS: readonly FileKindLook[] = [
  { kind: 'ticket', group: 'Chamados', label: 'Chamado', icon: 'confirmation_number', color: '#d29922' },
  { kind: 'script', group: 'Scripts', label: 'Script', icon: 'code', color: '#58a6ff' },
  { kind: 'analysis', group: 'Análises', label: 'Análise', icon: 'description', color: '#a371f7' },
  { kind: 'data', group: 'Dados', label: 'Dados', icon: 'dataset', color: '#3fb950' },
  { kind: 'text', group: 'Textos', label: 'Texto', icon: 'notes', color: '#8b949e' },
  { kind: 'attachment', group: 'Anexos', label: 'Anexo', icon: 'attach_file', color: '#8b949e' }
];

const KINDS = new Set<string>(FILE_KIND_LOOKS.map((k) => k.kind));

/** Kind desconhecido (ou `image` do plano) vira anexo. */
export function normalizeFileKind(kind: string | null | undefined): WorkItemFileKind {
  const k = `${kind ?? ''}`.trim().toLowerCase();
  return (KINDS.has(k) ? k : 'attachment') as WorkItemFileKind;
}

export function fileKindLook(kind: string | null | undefined): FileKindLook {
  const k = normalizeFileKind(kind);
  return FILE_KIND_LOOKS.find((x) => x.kind === k)!;
}

/** Ícone por arquivo: imagem ganha `image`, o resto segue o kind. */
export function fileIcon(f: Pick<WorkItemFile, 'kind' | 'name' | 'contentType'>): string {
  if (filePreviewKind(f) === 'image') return 'image';
  return fileKindLook(f.kind).icon;
}

/** Lista crua do servidor → arquivos válidos (kind normalizado, sem repetidos), mais novos primeiro. */
export function normalizeFiles(raw: unknown): WorkItemFile[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { files?: unknown })?.files) ? (raw as { files: unknown[] }).files : [];
  const seen = new Set<string>();
  const out: WorkItemFile[] = [];
  for (const r of list as Partial<WorkItemFile>[]) {
    if (!r || r.id == null || !`${r.name ?? ''}`.trim()) continue;
    const source: WorkItemFileSource = r.source === 'plan' ? 'plan' : 'item';
    const key = `${source}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, id: `${r.id}`, name: `${r.name}`.trim(), kind: normalizeFileKind(r.kind), source } as WorkItemFile);
  }
  return out.sort(compareFiles);
}

function compareFiles(a: WorkItemFile, b: WorkItemFile): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
  if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return tb - ta;
  if (isNaN(ta) !== isNaN(tb)) return isNaN(ta) ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/** Só os arquivos de uma sub-tarefa (`taskNumber`); sem filtro devolve todos. */
export function filesOfTask(files: readonly WorkItemFile[], taskNumber?: number | null): WorkItemFile[] {
  if (taskNumber == null) return files.slice();
  return files.filter((f) => f.taskNumber != null && Number(f.taskNumber) === Number(taskNumber));
}

/** 0087: só os arquivos de um item (`0` = os de planos sem item); sem filtro (`undefined`) devolve todos. */
export function filesOfItem(files: readonly WorkItemFile[], itemNumber?: number | null): WorkItemFile[] {
  if (itemNumber === undefined || itemNumber === null) return files.slice();
  return files.filter((f) => Number(f.workItemNumber ?? 0) === Number(itemNumber));
}

/** 0087: quantos arquivos cada item tem (chave = número do item; 0 = sem item). */
export function countFilesByItem(files: readonly WorkItemFile[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const f of files) {
    const n = Number(f.workItemNumber ?? 0);
    map.set(n, (map.get(n) ?? 0) + 1);
  }
  return map;
}

export interface FileGroup {
  look: FileKindLook;
  files: WorkItemFile[];
}

/** Agrupa por tipo na ordem de `FILE_KIND_LOOKS` (grupos vazios ficam de fora). */
export function groupFiles(files: readonly WorkItemFile[]): FileGroup[] {
  return FILE_KIND_LOOKS
    .map((look) => ({ look, files: files.filter((f) => normalizeFileKind(f.kind) === look.kind) }))
    .filter((g) => g.files.length > 0);
}

/** "3 arquivos" / "1 arquivo" / "Nenhum arquivo". */
export function filesCountLabel(n: number): string {
  if (!n) return 'Nenhum arquivo';
  return `${n} arquivo${n === 1 ? '' : 's'}`;
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || !isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Linha de detalhes: tamanho · data · #sub-tarefa · "do plano". */
export function fileMeta(f: WorkItemFile, formatNumber: (n: number) => string = (n) => `#${n}`, withSource = true): string {
  const parts: string[] = [];
  const size = fileSizeLabel(f.size);
  if (size) parts.push(size);
  if (f.createdAt) {
    const d = new Date(f.createdAt);
    if (!isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0');
      parts.push(`${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`);
    }
  }
  if (f.taskNumber != null) parts.push(`sub-tarefa ${formatNumber(Number(f.taskNumber))}`);
  if (withSource && f.source === 'plan') parts.push('do plano');
  return parts.join(' · ');
}

export type FilePreviewKind = 'markdown' | 'code' | 'json' | 'text' | 'image' | 'none';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const CODE_EXT = /\.(sql|sh|bash|py|ps1|cs|js|ts|xml|ya?ml|html?|css)$/i;
const TEXT_EXT = /\.(txt|log|csv|tsv)$/i;

/** Como abrir o arquivo: markdown renderizado, código/texto/JSON em bloco, imagem, ou só baixar. */
export function filePreviewKind(f: Pick<WorkItemFile, 'kind' | 'name' | 'contentType'>): FilePreviewKind {
  const type = `${f.contentType ?? ''}`.toLowerCase();
  const name = f.name ?? '';
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  if (/\.(md|markdown)$/i.test(name) || type.includes('markdown')) return 'markdown';
  if (/\.json$/i.test(name) || type.includes('json')) return 'json';
  if (CODE_EXT.test(name)) return 'code';
  if (TEXT_EXT.test(name) || type.startsWith('text/')) return 'text';
  // Sem extensão: chamado/análise/texto gerados são markdown.
  if (!/\.[a-z0-9]{1,6}$/i.test(name) && (f.kind === 'ticket' || f.kind === 'analysis' || f.kind === 'text')) return 'markdown';
  return 'none';
}

/** Dá para copiar como texto (abrir no visualizador também). */
export function isTextFile(f: Pick<WorkItemFile, 'kind' | 'name' | 'contentType'>): boolean {
  const k = filePreviewKind(f);
  return k !== 'image' && k !== 'none';
}

/** Linguagem do bloco de código (cerca do markdown) pelo nome do arquivo. */
export function codeLanguage(name: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const map: Record<string, string> = { sh: 'bash', bash: 'bash', ps1: 'powershell', py: 'python', cs: 'csharp', js: 'javascript', ts: 'typescript', yml: 'yaml', htm: 'html' };
  return map[ext] ?? ext;
}

/** Texto do arquivo → markdown para o visualizador (código/JSON/texto em bloco cercado). */
export function fileTextAsMarkdown(f: Pick<WorkItemFile, 'kind' | 'name' | 'contentType'>, text: string): string {
  const kind = filePreviewKind(f);
  if (kind === 'markdown') return text;
  let body = text;
  if (kind === 'json') {
    try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* como veio */ }
  }
  const fence = body.includes('```') ? '~~~~' : '```';
  const lang = kind === 'json' ? 'json' : kind === 'code' ? codeLanguage(f.name) : '';
  return `${fence}${lang}\n${body.replace(/\s+$/, '')}\n${fence}`;
}

/**
 * URL do conteúdo: `contentUrl` absoluto vale como está; `/api/...` ou `api/...` vai no host da API; o resto é
 * relativo a `apiUrl` (que termina com `/api/v1/`). Sem `contentUrl`: `WorkItems/{number}/files/{id}/content`.
 */
export function resolveFileContentUrl(apiUrl: string, itemNumber: number, f: Pick<WorkItemFile, 'id' | 'contentUrl'>): string {
  // (0087: na lista do card cada arquivo traz o seu `contentUrl`; `itemNumber` só vale sem ele.)
  const base = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  const url = `${f.contentUrl ?? ''}`.trim();
  if (!url) return `${base}WorkItems/${itemNumber}/files/${encodeURIComponent(f.id)}/content`;
  if (/^https?:\/\//i.test(url)) return url;
  const host = base.replace(/\/api\/v\d+(\.\d+)?\/$/i, '');
  if (/^\/?api\//i.test(url)) return `${host}/${url.replace(/^\//, '')}`;
  return `${base}${url.replace(/^\//, '')}`;
}

/** O evento do tempo real é de arquivo (deste item, ou sem número = recarregar tudo). */
export function isFilesEvent(p: { action?: string | null; number?: number | null } | null, itemNumber: number): boolean {
  if (!p) return true;
  if (p.number != null && Number(p.number) !== itemNumber) return false;
  return !p.action || p.action === 'file' || p.action === 'files' || p.action === 'task' || p.action === 'status';
}

/** Kind sugerido para um upload pelo nome/tipo (a pessoa pode trocar antes de enviar). */
export function guessUploadKind(name: string, contentType?: string | null): WorkItemFileKind {
  const n = name.toLowerCase();
  const t = `${contentType ?? ''}`.toLowerCase();
  if (/\.(sql|sh|bash|ps1|py)$/.test(n)) return 'script';
  if (/\.(csv|tsv|json|xlsx?|xml)$/.test(n) || t.includes('csv') || t.includes('spreadsheet')) return 'data';
  if (/chamado|ticket/.test(n)) return 'ticket';
  if (/an[aá]lise|analysis/.test(n)) return 'analysis';
  if (/\.(md|txt)$/.test(n)) return 'text';
  return 'attachment';
}
