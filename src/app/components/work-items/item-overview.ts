import { WorkItem, WorkTask } from './work-item.model';
import { WorkItemFile, normalizeFileKind } from './work-item-files';

/**
 * Card 78161: Visão geral rica de qualquer item de trabalho (o item de análise tem a dele em `analysis-overview`) —
 * para que serve, as etapas com a manchete do resultado, o documento do item na tela (com troca entre os documentos das
 * sub-tarefas e os prints) e a ficha do pedido com o mesmo visual da análise (resumo em destaque, seções, selos, links).
 *
 * Retrocompatível: a descrição antiga em parágrafos `**Rótulo:** texto` (itens criados pelo especialista antes desta
 * mudança, sem acento) vira a mesma ficha; descrição nova em markdown com `## Para que serve` usa o próprio texto.
 */

// ── Gravidade no título (`[Crítica]`, `[Alta]`...) ──────────────────────────────────────────────

export type ItemSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SeverityInfo {
  severity: ItemSeverity;
  label: string;
}

const SEVERITIES: Record<string, SeverityInfo> = {
  critica: { severity: 'critical', label: 'Crítica' },
  alta: { severity: 'high', label: 'Alta' },
  media: { severity: 'medium', label: 'Média' },
  baixa: { severity: 'low', label: 'Baixa' }
};

const SEVERITY_TAG = /\s*\[(cr[ií]tica|alta|m[eé]dia|baixa)\]\s*/i;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Gravidade marcada no título (`GS-001 — [Crítica] ...`) e o título sem a marca. */
export function titleSeverity(title: string | null | undefined): { severity: SeverityInfo | null; title: string } {
  const t = title ?? '';
  const m = SEVERITY_TAG.exec(t);
  if (!m) return { severity: null, title: t };
  const clean = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+—\s+$/, '').replace(/\s{2,}/g, ' ').trim();
  return { severity: SEVERITIES[fold(m[1])] ?? null, title: clean };
}

// ── Descrição → para que serve + ficha ──────────────────────────────────────────────────────────

export interface ItemBrief {
  /** O que o item faz e entrega (uma ou duas frases), em destaque no topo. */
  purpose: string | null;
  /** O resto da descrição em markdown (resumo em callout, seções), ou null. */
  body: string | null;
  /** Veio do formato antigo `**Rótulo:** texto`. */
  legacy: boolean;
}

type Field = 'purpose' | 'deliverable' | 'problem' | 'impact' | 'where' | 'modules' | 'base' | 'proposal' | 'acceptance' | 'rules' | 'other';

const FIELD_LABELS: [RegExp, Field][] = [
  [/^(o que (sera|vai ser) feito|para que serve|objetivo|por que existe)$/, 'purpose'],
  [/^(entregavel|entregaveis|resultado esperado)$/, 'deliverable'],
  [/^(achado|problema|o problema|o achado|sintoma)$/, 'problem'],
  [/^impacto$/, 'impact'],
  [/^onde$/, 'where'],
  [/^(itens da base solvace|base solvace|engenharia reversa)$/, 'base'],
  [/^(modulos?|modulos afetados|repositorios?)$/, 'modules'],
  [/^(proposta inicial|proposta|solucao|solucao proposta|sugestao)$/, 'proposal'],
  [/^criterios de aceite$/, 'acceptance'],
  [/^(regras|restricoes)$/, 'rules']
];

interface LabeledPart {
  field: Field;
  label: string;
  /** Texto entre parênteses no rótulo (`Onde (a confirmar em origin/master)`). */
  note: string | null;
  text: string;
}

const LABELED = /^\*\*([^*\n]{2,80}?):\*\*\s*([\s\S]*)$/;

function fieldOf(label: string): { field: Field; note: string | null } {
  const note = /\(([^)]*)\)\s*$/.exec(label)?.[1]?.trim() || null;
  const key = fold(label.replace(/\([^)]*\)\s*$/, '')).replace(/\s+/g, ' ').trim();
  const field = FIELD_LABELS.find(([re]) => re.test(key))?.[1] ?? 'other';
  return { field, note };
}

/** Parágrafos `**Rótulo:** texto` (o formato antigo); null quando a descrição não segue esse formato. */
function parseLabeled(text: string): LabeledPart[] | null {
  // Parágrafos — e rótulos colados na mesma linha (`**Modulos:** x. **Base Solvace:** y`) ou na linha de baixo.
  const paragraphs = text.split(/\n\s*\n|\n(?=\*\*[^*\n]{2,80}?:\*\*)|(?<=[.;])\s+(?=\*\*[^*\n]{2,80}?:\*\*)/)
    .map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length < 2 || /^#{1,6}\s|^>\s*\[!/m.test(text)) return null;
  const parts: LabeledPart[] = [];
  let labeled = 0;
  for (const p of paragraphs) {
    const m = LABELED.exec(p);
    if (m) {
      labeled++;
      const { field, note } = fieldOf(m[1].trim());
      parts.push({ field, label: m[1].trim(), note, text: m[2].trim() });
    } else {
      parts.push({ field: 'other', label: '', note: null, text: p });
    }
  }
  return labeled >= 2 && labeled / paragraphs.length >= 0.6 ? parts : null;
}

const quote = (text: string) => text.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');

/** `a; b; c` → lista (critérios de aceite antigos vinham numa linha só). */
function toList(text: string): string {
  if (/^\s*[-*]\s|^\s*\d+[.)]\s/m.test(text)) return text;
  const items = text.split(/;\s+/).map((s) => s.trim().replace(/[.;]$/, '')).filter(Boolean);
  return items.length > 1 ? items.map((s) => `- ${s}`).join('\n') : text;
}

function legacyBody(parts: LabeledPart[]): string {
  const of = (f: Field) => parts.filter((p) => p.field === f);
  const out: string[] = [];
  const summary = [...of('problem'), ...of('impact'), ...of('proposal')]
    .map((p) => `**${p.field === 'problem' ? 'Problema' : p.field === 'impact' ? 'Impacto' : 'Proposta inicial (a validar)'}:** ${p.text}`);
  if (summary.length) out.push(`> [!SUMMARY]\n${quote(summary.join('\n\n'))}`);
  for (const p of of('where')) {
    out.push(`### Onde\n${p.text}${p.note ? `\n\n*${p.note.charAt(0).toUpperCase()}${p.note.slice(1)}.*` : ''}`);
  }
  for (const p of of('modules')) out.push(`### Módulos\n${p.text}`);
  for (const p of of('base')) out.push(`### Base Solvace\n${p.text}`);
  for (const p of of('deliverable')) out.push(`### Entregável\n${p.text}`);
  for (const p of of('acceptance')) out.push(`### Critérios de aceite\n${toList(p.text)}`);
  for (const p of of('other')) out.push(p.label ? `**${p.label}:** ${p.text}` : p.text);
  for (const p of of('rules')) out.push(`> [!WARNING]\n${quote(`**Regras:** ${p.text}`)}`);
  return out.join('\n\n');
}

const PURPOSE_HEADING = /^#{2,3}\s*(para que serve|o que (?:vai ser|ser[aá]) feito|objetivo)\s*$/im;

/** Descrição do item → para que serve + ficha (markdown). Sem descrição, tudo null. */
export function parseItemBrief(description: string | null | undefined): ItemBrief {
  const text = (description ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return { purpose: null, body: null, legacy: false };

  const parts = parseLabeled(text);
  if (parts) {
    const purpose = parts.filter((p) => p.field === 'purpose').map((p) => p.text).join('\n\n') || null;
    const body = legacyBody(parts.filter((p) => p.field !== 'purpose'));
    return { purpose, body: body || null, legacy: true };
  }

  const m = PURPOSE_HEADING.exec(text);
  if (m) {
    const after = text.slice(m.index + m[0].length);
    const end = after.search(/^#{1,6}\s|^>\s*\[!/m);
    const purpose = (end < 0 ? after : after.slice(0, end)).trim() || null;
    const body = (text.slice(0, m.index) + (end < 0 ? '' : after.slice(end))).trim() || null;
    return { purpose, body, legacy: false };
  }
  return { purpose: null, body: text, legacy: false };
}

// ── Etapas (sub-tarefas) com a manchete do resultado ────────────────────────────────────────────

/**
 * A manchete de um resultado: o negrito do começo (`**Legado: persiste.** ...`) ou a primeira frase, curta. Código e
 * negrito ficam (a tela renderiza em markdown).
 */
export function resultHeadline(result: string | null | undefined, max = 180): string | null {
  const text = (result ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const bold = /^\*\*((?:[^*]|\*(?!\*)){3,200}?)\*\*/.exec(text);
  if (bold) return `**${bold[1].trim()}**`;
  return firstSentence(text.replace(/^\*\*/, ''), max);
}

function firstSentence(text: string, max: number): string {
  // Primeira frase (o ponto não pode estar dentro de `código`).
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '`') inCode = !inCode;
    if (!inCode && (c === '.' || c === '!' || c === '?') && (i + 1 === text.length || text[i + 1] === ' ') && i >= 20) {
      const s = text.slice(0, i + 1);
      return balanced(s.length <= max ? s : clip(s, max));
    }
  }
  return balanced(clip(text, max));
}

/** Negrito aberto e não fechado no recorte não pode vazar `**` cru na tela. */
function balanced(s: string): string {
  return (s.match(/\*\*/g) ?? []).length % 2 ? s.replace(/\*\*/g, '') : s;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const ticks = (cut.match(/`/g) ?? []).length;
  const safe = ticks % 2 ? cut.slice(0, cut.lastIndexOf('`')) : cut;
  return safe.replace(/\s+\S*$/, '').trimEnd() + '…';
}

/** `3. Analisar a fundo no codigo (GS-002)` → `Analisar a fundo no codigo` (o número e o código do item já aparecem). */
export function stepTitle(title: string, itemCode?: string | null): string {
  let t = (title ?? '').replace(/^\s*\d+[.)]\s*/, '');
  if (itemCode) t = t.replace(new RegExp(`\\s*\\(${itemCode}\\)`, 'i'), '');
  return t.replace(/\s+—\s+OBRIGAT[OÓ]RIO.*$/i, '').trim() || title;
}

/** Código do item no título (`GS-001`, `UC-12`) para limpar os títulos das etapas. */
export function itemCode(title: string | null | undefined): string | null {
  return /^\s*([A-Z]{1,6}-\d{1,5})\b/.exec(title ?? '')?.[1] ?? null;
}

// ── Documentos do item (os .md das sub-tarefas) e os prints ─────────────────────────────────────

const OVERVIEW_DOC = /(^|[-_])vis[aã]o[-_ ]geral|^00[-_]/i;
const DOC_KINDS = new Set(['analysis', 'evidence', 'text', 'ticket']);

export const isOverviewDoc = (f: Pick<WorkItemFile, 'name'>) => OVERVIEW_DOC.test(f.name ?? '');

const isMarkdown = (f: WorkItemFile) => /\.md$/i.test(f.name ?? '');
const isImage = (f: WorkItemFile) => /^image\//i.test(f.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? '');

/**
 * Documentos que o item produziu: `.md` de uma sub-tarefa (ou o `00-visao-geral`) — nunca os anexos copiados do card
 * nem os do plano. A visão geral primeiro; depois na ordem das sub-tarefas (e pelo nome).
 */
export function itemDocuments(files: readonly WorkItemFile[], tasks: readonly Pick<WorkTask, 'number' | 'order'>[]): WorkItemFile[] {
  const order = new Map(tasks.map((t) => [t.number, t.order]));
  const docs = files.filter((f) => f.source !== 'plan' && f.source !== 'document' && f.source !== 'case' && isMarkdown(f)
    && DOC_KINDS.has(normalizeFileKind(f.kind)) && (f.taskNumber != null || isOverviewDoc(f)));
  const rank = (f: WorkItemFile) => (isOverviewDoc(f) ? -1 : order.get(f.taskNumber ?? -1) ?? 999);
  return docs.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** O documento que abre primeiro: a visão geral; sem ela, o da última sub-tarefa concluída (a proposta/conclusão). */
export function pickItemDocument(docs: readonly WorkItemFile[]): WorkItemFile | null {
  return docs.find(isOverviewDoc) ?? docs[docs.length - 1] ?? null;
}

/** Prints que as sub-tarefas gravaram (imagens com sub-tarefa), por sub-tarefa. */
export function itemImages(files: readonly WorkItemFile[]): WorkItemFile[] {
  return files.filter((f) => f.source !== 'plan' && f.taskNumber != null && isImage(f)).sort((a, b) => a.name.localeCompare(b.name));
}

/** `05-proposta-GS-001.md` / `gs-104-proposta.md` → `Proposta`. */
export function docLabel(name: string, code?: string | null): string {
  if (OVERVIEW_DOC.test(name) && /vis[aã]o[-_ ]geral/i.test(name)) return 'Visão geral';
  let t = name.replace(/\.md$/i, '');
  if (code) t = t.replace(new RegExp(`[-_ ]?${code}[-_ ]?`, 'ig'), '-');
  t = t.replace(/^[-_ ]*\d+[-_ ]+/, '').replace(/[-_]+/g, ' ').trim();
  const words: Record<string, string> = {
    analise: 'análise', codigo: 'código', reproducao: 'reprodução', solucao: 'solução', proposta: 'proposta', resumo: 'resumo',
    engenharia: 'engenharia', reversa: 'reversa', caso: 'caso', decisao: 'decisão', conclusao: 'conclusão', evidencias: 'evidências'
  };
  t = t.split(' ').map((w) => words[w.toLowerCase()] ?? w).join(' ');
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : name;
}

// ── O que a tela mostra ─────────────────────────────────────────────────────────────────────────

/** Item com a visão rica: tem ficha (para que serve/formato antigo), documentos ou etapas com resultado. */
export function hasRichOverview(item: Pick<WorkItem, 'tasks'> | null, brief: ItemBrief, docs: readonly WorkItemFile[]): boolean {
  if (!item) return false;
  return !!brief.purpose || brief.legacy || docs.length > 0 || (item.tasks ?? []).some((t) => !!t.result?.trim());
}

// ── Visão geral sempre à vista (arquivo ou prévia da descrição) ─────────────────────────────────

/** Nome do arquivo da visão geral do item: `00-visao-geral-GS-001.md` (sem código no título: `00-visao-geral-item-96.md`). */
export function overviewFileName(item: Pick<WorkItem, 'title' | 'number'>): string {
  return `00-visao-geral-${itemCode(item.title) ?? `item-${item.number}`}.md`;
}

/** A ficha do pedido como markdown de um arquivo (para que serve + o resto) — a prévia da visão geral. */
export function briefMarkdown(brief: ItemBrief, title?: string | null): string | null {
  const parts = [
    title ? `**${title}**` : null,
    brief.purpose ? `## Para que serve\n${brief.purpose}` : null,
    brief.body
  ].filter(Boolean);
  return brief.purpose || brief.body ? parts.join('\n\n') : null;
}

/** Arquivo de texto que a tela edita (markdown, texto, SQL, CSV, JSON). */
export function isEditableText(f: Pick<WorkItemFile, 'name' | 'contentType'>): boolean {
  return /\.(md|markdown|txt|sql|csv|json)$/i.test(f.name ?? '') || /^text\//i.test(f.contentType ?? '');
}
