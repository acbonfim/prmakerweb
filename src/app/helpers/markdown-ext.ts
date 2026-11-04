import {
  Marked,
  type MarkedExtension,
  type RendererThis,
  type Token,
  type Tokens,
  type TokenizerAndRendererExtension,
} from 'marked';

/**
 * Markdown do PRMake com extensões (feature 0075/F1). Instância própria do marked — não mexe nas
 * opções globais (`marked.setOptions` é chamado em outros lugares). Extensões:
 *
 * - **Callouts** estilo GitHub: `> [!SUMMARY]`, `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`,
 *   `[!CAUTION]` → `<div class="md-callout md-callout--<tipo>">`.
 * - **Links de código** `[texto](ref:<id>)` → `<a class="code-ref" href="#ref/<id>">`.
 * - **Citações** `caminho:linha` / `caminho:ini-fim` (texto ou código inline) →
 *   `<a class="code-cite" href="#cite/<caminho>:<ini>-<fim>">`.
 * - **Imagens** `![alt](anexo:<nome>)` → `<img class="md-attachment" title="anexo:<nome>" src="">` (a F3
 *   carrega pelo nome); 2+ imagens `anexo:` seguidas no mesmo parágrafo → `<span class="md-gallery">`.
 *
 * O HTML vai para `[innerHTML]` (sanitizador do Angular mantém `class`, `title`, `href`, `src`, `alt`) —
 * por isso a marcação usa só esses atributos; o clique nos links é tratado por delegação (F2).
 *
 * 0076 (design system do markdown):
 * - **Tabelas** dentro de `<div class="md-table">` (rolagem própria, cantos arredondados); primeira coluna
 *   só de números → `md-table--num` (estreita e esmaecida).
 * - **Selos**: `**Alterar**`, `**Criar**`, `**Remover**`, `**Suspeito**`, `**Só leitura**`/`**Leitura**`,
 *   `**Confirmado:**`, `**Hipótese:**`, `**Descartado**`, `**Recomendada**` → `<span class="md-badge
 *   md-badge--<tipo>">`. Emojis antigos da skill (✏️ ➕ 🗑️ 👁️ ⚠️ ✅ ❓) no começo de uma célula ou antes do
 *   rótulo viram o mesmo selo (textos já publicados ficam iguais aos novos).
 * - **Itens da engenharia reversa** (`reRefs`): `UC-121`, `revamp-kaizen#RN-012` → `<a class="re-ref"
 *   href="#re/<ref>">` (popover do item pela `appCodeRefHost`).
 */

export interface RenderMarkdownOptions {
  /** Liga links de código (`ref:`), citações e imagens `anexo:`. Desligado: `ref:` vira `<code>`,
   *  citações ficam texto e `anexo:` vira só o texto alternativo em itálico (ex.: handover público). */
  codeRefs: boolean;
  /** Liga os links dos itens da engenharia reversa (`UC-121`, `modulo#RN-012`) — só onde há um card
   *  (o popover consulta o item pelo card). Padrão: desligado (telas da própria engenharia reversa). */
  reRefs?: boolean;
}

export interface Citation {
  path: string;
  start: number;
  end: number;
}

// ── Funções puras ────────────────────────────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

/** Extensões de código aceitas quando a citação não tem `/` (só o nome do arquivo). */
export const CODE_EXTENSIONS = [
  'asp', 'aspx', 'cs', 'cshtml', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'html', 'htm', 'css', 'scss', 'sql',
  'json', 'java', 'py', 'sh', 'xml', 'vb', 'config', 'yml', 'yaml', 'md',
];
const EXT_RE = new RegExp(`\\.(?:${CODE_EXTENSIONS.join('|')})$`, 'i');

// Caracteres de um segmento de caminho (sem `/`); a citação não pode começar colada num deles nem em
// `/` (evita pegar pedaço de URL ou de outro caminho).
const SEG = '[\\p{L}\\p{N}_.\\-]+';
const CITE_BODY = `(\\/?${SEG}(?:\\/${SEG})*):(\\d{1,6})(?:[-–](\\d{1,6}))?(?![\\p{L}\\p{N}_])`;
const CITE_SEARCH = new RegExp(`(?<![\\p{L}\\p{N}_./\\-])${CITE_BODY}`, 'gu');
const CITE_AT_START = new RegExp(`^${CITE_BODY}`, 'u');
const CITE_EXACT = new RegExp(`^${CITE_BODY}$`, 'u');
const CODESPAN_AT_START = /^`([^`\n]+)`(?!`)/;

/** O caminho parece arquivo de código? (tem `/` com um nome de verdade no fim, ou extensão conhecida) */
export function isCitationPath(path: string): boolean {
  if (!path || /^www\./i.test(path)) return false;
  if (path.includes('/')) {
    const last = path.slice(path.lastIndexOf('/') + 1);
    return /\p{L}/u.test(last); // "04/11" (data) não; "src/Makefile" sim
  }
  return EXT_RE.test(path);
}

function toCitation(m: RegExpExecArray): Citation | null {
  const path = m[1];
  if (!isCitationPath(path)) return null;
  const start = Number(m[2]);
  const end = m[3] !== undefined ? Number(m[3]) : start;
  if (!start || !end) return null;
  return { path, start: Math.min(start, end), end: Math.max(start, end) };
}

/** `caminho:linha` ou `caminho:ini-fim` (o texto inteiro, sem espaços nas pontas) → citação, ou null. */
export function parseCitation(text: string | null | undefined): Citation | null {
  if (!text) return null;
  const m = CITE_EXACT.exec(text.trim());
  return m ? toCitation(m) : null;
}

/** Todas as citações de um texto (texto puro, sem considerar a estrutura do markdown). */
export function findCitations(text: string | null | undefined): (Citation & { index: number; raw: string })[] {
  const out: (Citation & { index: number; raw: string })[] = [];
  if (!text) return out;
  const re = new RegExp(CITE_SEARCH.source, CITE_SEARCH.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = toCitation(m);
    if (c) out.push({ ...c, index: m.index, raw: m[0] });
  }
  return out;
}

export function hasCitation(text: string | null | undefined): boolean {
  return firstCitationIndex(text ?? '') >= 0;
}

function firstCitationIndex(src: string): number {
  if (!src) return -1;
  const re = new RegExp(CITE_SEARCH.source, CITE_SEARCH.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (toCitation(m)) return m.index;
  }
  return -1;
}

/** href interno de uma citação: `#cite/<caminho codificado>:<ini>-<fim>`. */
export function citationHref(c: Citation): string {
  return `#cite/${encodeURIComponent(c.path)}:${c.start}-${c.end}`;
}

const REF_ID = /^[a-z0-9][a-z0-9._-]{0,59}$/;

/** `ref:<id>` → id normalizado (minúsculas) ou null se não for um id válido. */
export function parseRefHref(href: string | null | undefined): string | null {
  const m = /^ref:(.*)$/i.exec((href ?? '').trim());
  if (!m) return null;
  const id = m[1].trim().toLowerCase();
  return REF_ID.test(id) ? id : null;
}

function isRefHref(href: string | null | undefined): boolean {
  return /^\s*ref:/i.test(href ?? '');
}

const ANEXO = /^\s*anexo:(.*)$/i;

/** `anexo:<nome>` → nome (sem espaços nas pontas) ou null. */
export function parseAttachmentHref(href: string | null | undefined): string | null {
  const m = ANEXO.exec(href ?? '');
  if (!m) return null;
  const name = m[1].trim();
  return name ? name : null;
}

const UNSAFE_HREF = /^\s*(?:javascript|vbscript|data):/i;

// ── Itens da engenharia reversa (0076) ───────────────────────────────────────────────────────────

/** Prefixos dos IDs de item da engenharia reversa (`UC-121`, `RN-012`, `API-004`…). */
export const RE_PREFIXES = [
  'FN', 'UC', 'RN', 'PRF', 'EST', 'NTF', 'CFG', 'REL', 'TEC', 'CMP', 'API', 'DB', 'EVT', 'JOB', 'SQL', 'TRG', 'INF',
  'INT', 'TELA', 'FLX', 'OBJ', 'PER', 'GLO', 'ADR', 'NFR', 'SEQ', 'UI', 'TUT', 'FAQ', 'GAP',
];
const RE_BODY = `(?:[A-Za-z0-9][A-Za-z0-9_.\\-]*#)?(?:${RE_PREFIXES.join('|')})-\\d{1,4}(?![\\p{L}\\p{N}_\\-])`;
// Não começa colado em letra/número nem em pedaço de URL/caminho (`/`, `=`, `#`, `.`, `-`…).
const RE_BEFORE = '(?<![\\p{L}\\p{N}_#/.\\-=?&@])';
const RE_SEARCH = new RegExp(`${RE_BEFORE}${RE_BODY}`, 'gu');
const RE_AT_START = new RegExp(`^${RE_BODY}`, 'u');
const RE_EXACT = new RegExp(`^${RE_BODY}$`, 'u');

/** Ref de item (`UC-121` / `modulo#UC-121`) do texto inteiro, ou null. */
export function parseReRef(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  return RE_EXACT.test(t) ? t : null;
}

/** Refs de item num texto puro (na ordem, com repetição). */
export function findReRefs(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(new RegExp(RE_SEARCH.source, RE_SEARCH.flags))].map(m => m[0]);
}

export function hasReRef(text: string | null | undefined): boolean {
  return firstReIndex(text ?? '') >= 0;
}

function firstReIndex(src: string): number {
  if (!src) return -1;
  const re = new RegExp(RE_SEARCH.source, 'u');
  const m = re.exec(src);
  return m ? m.index : -1;
}

/** href interno do item: `#re/<ref codificada>` (o `#` do módulo vira `%23`). */
export function reRefHref(ref: string): string {
  return `#re/${encodeURIComponent(ref)}`;
}

/** `#re/<ref>` → ref (`revamp-kaizen#UC-121`) ou null. */
export function parseReHref(href: string | null | undefined): string | null {
  const h = (href ?? '').trim();
  if (!h.startsWith('#re/')) return null;
  let ref = h.slice(4);
  try { ref = decodeURIComponent(ref); } catch { /* mantém */ }
  return parseReRef(ref);
}

// ── Selos (0076) ─────────────────────────────────────────────────────────────────────────────────

export type BadgeKind =
  | 'change' | 'create' | 'remove' | 'suspect' | 'read' | 'confirmed' | 'hypothesis' | 'discarded' | 'recommended';

const BADGE_LABELS: Record<string, BadgeKind> = {
  alterar: 'change',
  criar: 'create',
  remover: 'remove',
  suspeito: 'suspect',
  'só leitura': 'read',
  'so leitura': 'read',
  'somente leitura': 'read',
  leitura: 'read',
  confirmado: 'confirmed',
  'hipótese': 'hypothesis',
  hipotese: 'hypothesis',
  descartado: 'discarded',
  descartada: 'discarded',
  recomendada: 'recommended',
  recomendado: 'recommended',
};

/** Emojis antigos da skill → selo padrão (quando aparecem sozinhos no começo de uma célula). */
const LEGACY_EMOJIS: Record<string, { kind: BadgeKind; label: string }> = {
  '✏': { kind: 'change', label: 'Alterar' },
  '➕': { kind: 'create', label: 'Criar' },
  '\u{1F5D1}': { kind: 'remove', label: 'Remover' },
  '\u{1F441}': { kind: 'read', label: 'Só leitura' },
  '⚠': { kind: 'suspect', label: 'Suspeito' },
  '✅': { kind: 'confirmed', label: 'Confirmado' },
  '❓': { kind: 'hypothesis', label: 'Hipótese' },
};
const EMOJI_ALT = '(?:\\u270F|\\u2795|\\u{1F5D1}|\\u{1F441}|\\u26A0|\\u2705|\\u2753)\\uFE0F?';
const LABEL_ALT = Object.keys(BADGE_LABELS).sort((a, b) => b.length - a.length).join('|');
/** Emoji + rótulo (`✏️ alterar`, `✅ Confirmado:`) em qualquer lugar do texto. */
const LEGACY_WITH_LABEL = new RegExp(`(${EMOJI_ALT})[ \\t\\u00A0]*(${LABEL_ALT})(?![\\p{L}\\p{N}])(?:[ \\t]*:)?`, 'giu');
/** Emoji colado a um selo já pronto (`✅ **Confirmado:**`). */
const LEGACY_BEFORE_BADGE = new RegExp(`${EMOJI_ALT}[ \\t\\u00A0]*(?=<span class="md-badge)`, 'gu');
/** Emoji sozinho no começo de uma célula de tabela. */
const LEGACY_CELL_START = new RegExp(`(<t[dh](?:\\s[^>]*)?>)\\s*(${EMOJI_ALT})[ \\t\\u00A0]*`, 'gu');

/** Texto de um rótulo → tipo do selo (ignora caixa, espaços e `:` no fim), ou null. */
export function badgeKind(text: string | null | undefined): BadgeKind | null {
  const key = (text ?? '').normalize('NFC').trim().replace(/\s*:$/, '').replace(/\s+/g, ' ').toLowerCase();
  return BADGE_LABELS[key] ?? null;
}

export function badgeHtml(kind: BadgeKind, label: string): string {
  return `<span class="md-badge md-badge--${kind}">${escapeHtml(label)}</span>`;
}

function badgeLabel(text: string): string {
  const t = text.normalize('NFC').trim().replace(/\s*:$/, '').replace(/\s+/g, ' ');
  return t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
}

function emojiKey(emoji: string): string {
  return emoji.replace(/️/g, '');
}

/** Emojis antigos → selos, fora de `<pre>`/`<code>` (o HTML já renderizado). */
export function normalizeLegacyEmojis(html: string): string {
  if (!html || !/[✏➕⚠✅❓]|\u{1F5D1}|\u{1F441}/u.test(html)) return html;
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/)
    .map((part, i) => {
      if (i % 2) return part;
      return part
        .replace(LEGACY_BEFORE_BADGE, '')
        .replace(LEGACY_WITH_LABEL, (_m, _e: string, label: string) => badgeHtml(badgeKind(label)!, badgeLabel(label)))
        .replace(LEGACY_CELL_START, (_m, open: string, emoji: string) => {
          const meta = LEGACY_EMOJIS[emojiKey(emoji)];
          return meta ? `${open}${badgeHtml(meta.kind, meta.label)} ` : _m;
        });
    })
    .join('');
}

// ── Extensões do marked ──────────────────────────────────────────────────────────────────────────

const CALLOUT_LABELS: Record<string, string> = {
  summary: 'Resumo',
  note: 'Nota',
  tip: 'Dica',
  important: 'Importante',
  warning: 'Atenção',
  caution: 'Cuidado',
};
const CALLOUT_RE = new RegExp(
  `^ {0,3}> ?\\[!(${Object.keys(CALLOUT_LABELS).join('|')})\\][ \\t]*([^\\n]*)(?:\\n|$)((?: {0,3}>[^\\n]*(?:\\n|$))*)`,
  'i',
);

interface CalloutToken extends Tokens.Generic {
  type: 'callout';
  kind: string;
  tokens: Tokens.Generic[];
}

const calloutExtension: TokenizerAndRendererExtension = {
  name: 'callout',
  level: 'block',
  tokenizer(src) {
    const m = CALLOUT_RE.exec(src);
    if (!m) return undefined;
    const kind = m[1].toLowerCase();
    const rest = m[3]
      .split('\n')
      .map(line => line.replace(/^ {0,3}> ?/, ''))
      .join('\n');
    const content = (m[2].trim() ? m[2].trim() + '\n' : '') + rest;
    const top = this.lexer.state.top;
    this.lexer.state.top = true;
    const tokens = this.lexer.blockTokens(content, []);
    this.lexer.state.top = top;
    const token: CalloutToken = { type: 'callout', raw: m[0], kind, tokens };
    return token;
  },
  renderer(token) {
    const t = token as CalloutToken;
    const label = CALLOUT_LABELS[t.kind] ?? t.kind;
    return `<div class="md-callout md-callout--${t.kind}"><p class="md-callout__title">${label}</p>\n`
      + `${this.parser.parse(t.tokens)}</div>\n`;
  },
};

// O marked chama o `start` a cada pedaço de texto com o resto do parágrafo; como o resto é sempre um
// sufixo do anterior, reaproveita a última busca enquanto a citação achada ainda está à frente
// (evita varrer o parágrafo inteiro de novo a cada `_`/`*` em textos longos).
let memoSrc = '';
let memoIdx = -1;
function citationStart(src: string): number {
  if (memoSrc && src.length <= memoSrc.length && memoSrc.endsWith(src)) {
    const d = memoSrc.length - src.length;
    if (memoIdx < 0) return -1;
    if (memoIdx >= d) return memoIdx - d;
  }
  memoSrc = src;
  memoIdx = firstCitationIndex(src);
  return memoIdx;
}

interface CiteToken extends Tokens.Generic {
  type: 'codeCite';
  text: string;
  code: boolean;
  citation: Citation;
}

const citeExtension: TokenizerAndRendererExtension = {
  name: 'codeCite',
  level: 'inline',
  start(src) {
    if (this.lexer.state.inLink) return undefined;
    const i = citationStart(src);
    return i >= 0 ? i : undefined;
  },
  tokenizer(src) {
    if (this.lexer.state.inLink) return undefined;
    // Código inline que é só a citação: `a/b.js:336-353`
    const code = CODESPAN_AT_START.exec(src);
    if (code) {
      let text = code[1];
      // mesma regra do marked: tira um espaço de cada ponta quando há nas duas
      if (/[^ ]/.test(text) && text.startsWith(' ') && text.endsWith(' ')) text = text.slice(1, -1);
      const citation = parseCitation(text);
      if (!citation) return undefined;
      const token: CiteToken = { type: 'codeCite', raw: code[0], text, code: true, citation };
      return token;
    }
    const m = CITE_AT_START.exec(src);
    if (!m) return undefined;
    const citation = toCitation(m);
    if (!citation) return undefined;
    const token: CiteToken = { type: 'codeCite', raw: m[0], text: m[0], code: false, citation };
    return token;
  },
  renderer(token) {
    const t = token as CiteToken;
    const label = t.code ? `<code>${escapeHtml(t.text)}</code>` : escapeHtml(t.text);
    return `<a class="code-cite" href="${escapeHtml(citationHref(t.citation))}" title="Ver o código">${label}</a>`;
  },
};

interface ReRefToken extends Tokens.Generic {
  type: 'reRef';
  ref: string;
  code: boolean;
}

/** `UC-121` / `modulo#RN-012` (texto ou código inline só com o id) → link do item da engenharia reversa. */
const reRefExtension: TokenizerAndRendererExtension = {
  name: 'reRef',
  level: 'inline',
  start(src) {
    if (this.lexer.state.inLink) return undefined;
    const i = firstReIndex(src);
    return i >= 0 ? i : undefined;
  },
  tokenizer(src) {
    if (this.lexer.state.inLink) return undefined;
    const code = CODESPAN_AT_START.exec(src);
    if (code) {
      const ref = parseReRef(code[1]);
      if (!ref) return undefined;
      const token: ReRefToken = { type: 'reRef', raw: code[0], ref, code: true };
      return token;
    }
    const m = RE_AT_START.exec(src);
    if (!m) return undefined;
    const token: ReRefToken = { type: 'reRef', raw: m[0], ref: m[0], code: false };
    return token;
  },
  renderer(token) {
    const t = token as ReRefToken;
    const label = t.code ? `<code>${escapeHtml(t.ref)}</code>` : escapeHtml(t.ref);
    return `<a class="re-ref" href="${escapeHtml(reRefHref(t.ref))}" title="Ver o item da engenharia reversa">${label}</a>`;
  },
};

/** Primeira coluna só de números (`1`, `2.`, `#3`) → coluna estreita e esmaecida. */
const NUMERIC_CELL = /^\s*#?\d{1,4}[.)º]?\s*$/;

/** Texto puro dos tokens inline (sem marcação), já escapado. */
function plainText(parser: RendererThis['parser'], tokens: Token[] | undefined, fallback: string): string {
  const text = tokens ? parser.parseInline(tokens, parser.textRenderer) : fallback;
  return escapeHtml(text);
}

function isAttachmentImage(t: Tokens.Generic): boolean {
  return t.type === 'image' && parseAttachmentHref((t as Tokens.Image).href) !== null;
}

function isGallerySeparator(t: Tokens.Generic): boolean {
  return t.type === 'br' || (t.type === 'text' && !(t as Tokens.Text).text.trim());
}

function rendererExtension(codeRefs: boolean): MarkedExtension {
  return {
    renderer: {
      link(token) {
        if (isRefHref(token.href)) {
          if (!codeRefs) return `<code>${plainText(this.parser, token.tokens, token.text)}</code>`;
          const id = parseRefHref(token.href);
          const inner = this.parser.parseInline(token.tokens);
          if (!id) return inner;
          const title = token.title ? escapeHtml(token.title) : 'Ver o código';
          return `<a class="code-ref" href="#ref/${escapeHtml(id)}" title="${title}">${inner}</a>`;
        }
        if (UNSAFE_HREF.test(token.href ?? '')) return this.parser.parseInline(token.tokens);
        return false;
      },
      image(token) {
        if (ANEXO.test(token.href ?? '')) {
          const name = parseAttachmentHref(token.href);
          const alt = plainText(this.parser, token.tokens, token.text);
          if (!codeRefs || !name) return alt ? `<em>${alt}</em>` : '';
          return `<img class="md-attachment" alt="${alt}" title="${escapeHtml('anexo:' + name)}" src="">`;
        }
        if (UNSAFE_HREF.test(token.href ?? '') && !/^\s*data:image\//i.test(token.href ?? '')) {
          return plainText(this.parser, token.tokens, token.text);
        }
        return false;
      },
      paragraph(token) {
        if (!codeRefs) return false;
        const toks = token.tokens as Tokens.Generic[];
        if (toks.filter(isAttachmentImage).length < 2) return false;
        let out = '';
        let i = 0;
        while (i < toks.length) {
          if (isAttachmentImage(toks[i])) {
            const run = [toks[i]];
            let last = i;
            for (let j = i + 1; j < toks.length && (isAttachmentImage(toks[j]) || isGallerySeparator(toks[j])); j++) {
              if (isAttachmentImage(toks[j])) { run.push(toks[j]); last = j; }
            }
            if (run.length >= 2) {
              out += `<span class="md-gallery">${run.map(t => this.parser.parseInline([t as Tokens.Image])).join('')}</span>`;
              i = last + 1;
              continue;
            }
          }
          out += this.parser.parseInline([toks[i] as Tokens.Text]);
          i++;
        }
        return `<p>${out}</p>\n`;
      },
      // 0076: rótulo em negrito → selo (`**Alterar**`, `**Confirmado:**`, `**✅ Confirmado:**`).
      strong(token) {
        const text = this.parser.parseInline(token.tokens, this.parser.textRenderer)
          .replace(new RegExp(`^\\s*${EMOJI_ALT}\\s*`, 'u'), '');
        const kind = badgeKind(text);
        return kind ? badgeHtml(kind, badgeLabel(text)) : false;
      },
      // 0076: tabela dentro de um contêiner (rolagem própria, cantos, coluna numérica).
      table(token) {
        const head = this.tablerow({ text: token.header.map(c => this.tablecell(c)).join('') });
        const body = token.rows.map(r => this.tablerow({ text: r.map(c => this.tablecell(c)).join('') })).join('');
        const numeric = token.rows.length > 0 && token.rows.every(r => NUMERIC_CELL.test(r[0]?.text ?? ''));
        return `<div class="md-table${numeric ? ' md-table--num' : ''}"><table>\n<thead>\n${head}</thead>\n`
          + `${body ? `<tbody>${body}</tbody>` : ''}</table></div>\n`;
      },
    },
    hooks: {
      postprocess: normalizeLegacyEmojis,
    },
  };
}

const instances = new Map<string, Marked>();

function markedFor(codeRefs: boolean, reRefs: boolean): Marked {
  const key = `${codeRefs ? 1 : 0}${reRefs ? 1 : 0}`;
  let md = instances.get(key);
  if (!md) {
    const extensions: TokenizerAndRendererExtension[] = [calloutExtension];
    if (codeRefs) extensions.push(citeExtension);
    if (reRefs) extensions.push(reRefExtension);
    md = new Marked({ gfm: true, breaks: true, async: false }, { extensions }, rendererExtension(codeRefs));
    instances.set(key, md);
  }
  return md;
}

/** Markdown → HTML (gfm + quebras de linha) com as extensões do PRMake. */
export function renderMarkdown(text: string | null | undefined, options: RenderMarkdownOptions): string {
  if (!text) return '';
  return markedFor(!!options.codeRefs, !!options.reRefs).parse(text, { async: false }) as string;
}
