/**
 * Destaque de sintaxe leve (0075/F2) — sem dependência: comentários, strings, números e palavras-chave
 * por linguagem, com o HTML sempre escapado (código `<script>` nunca vira tag). Saída por linha (o
 * popover numera e destaca linha a linha), mas o estado passa de uma linha para a outra: comentário
 * de bloco, `<% %>` do ASP, tag HTML aberta e string entre aspas no HTML.
 *
 * Classes: `hl-k` palavra-chave · `hl-s` string · `hl-c` comentário · `hl-n` número · `hl-t` tag ·
 * `hl-a` atributo/propriedade/chave · `hl-d` delimitador (`<% %>`).
 */

export type HighlightLanguage =
  | 'csharp' | 'typescript' | 'javascript' | 'java' | 'css' | 'scss' | 'json' | 'sql' | 'python' | 'bash'
  | 'html' | 'asp' | 'vb' | 'plain';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ESC[ch]);
const span = (cls: string, text: string) => (text ? `<span class="${cls}">${esc(text)}</span>` : '');

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const KW_CSHARP = words(`abstract as async await base bool break byte case catch char checked class const continue decimal
  default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit
  in init int interface internal is lock long namespace new null object operator out override params partial private
  protected public readonly record ref required return sbyte sealed set short sizeof stackalloc static string struct
  switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while
  yield nameof dynamic value global not and or with`);
const KW_TS = words(`abstract any as async await boolean break case catch class const constructor continue debugger
  declare default delete do else enum export extends false finally for from function get if implements import in
  infer instanceof interface is keyof let module namespace never new null number object of override private protected
  public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined
  unique unknown var void while with yield`);
const KW_JAVA = words(`abstract assert boolean break byte case catch char class const continue default do double else
  enum extends final finally float for goto if implements import instanceof int interface long native new null package
  private protected public return short static strictfp super switch synchronized this throw throws transient true
  false try var void volatile while record sealed permits yield`);
const KW_SQL = words(`select from where and or not in is null as join inner left right outer full cross on group by
  order having insert into values update set delete merge using when matched then else end case begin commit rollback
  tran transaction declare exec execute create alter drop table view index procedure proc function trigger top
  distinct union all exists like between with nolock go if while return print cast convert coalesce isnull count sum
  avg min max over partition asc desc output inserted deleted primary key foreign references default constraint
  limit offset fetch next rows only returning varchar nvarchar int bigint bit datetime date decimal numeric char
  nchar text true false`);
const KW_PY = words(`and as assert async await break class continue def del elif else except False finally for from
  global if import in is lambda None nonlocal not or pass raise return True try while with yield self match case`);
const KW_BASH = words(`if then else elif fi case esac for while until do done in function return local export
  readonly declare unset shift exit set source echo printf cd test true false`);
const KW_VB = words(`and as boolean byref byval call case class const dim do each else elseif empty end erase error
  exit explicit false for function get goto if in is let loop me mod new next not nothing null on option or preserve
  private property public redim rem resume select set step sub then to true until wend while with xor response
  request server session application`);
const KW_CSS = words(`important media import supports keyframes font-face include mixin extend use forward if else
  each for function return`);
const KW_JSON = words('true false null');

interface CLike {
  line?: string[];          // comentários de linha
  block?: [string, string]; // comentário de bloco
  quotes: string;           // aspas de string
  doubledQuote?: boolean;   // '' dentro da string (SQL/VB) em vez de \'
  keywords: Set<string>;
  ci?: boolean;             // palavras-chave sem diferenciar maiúsculas
  props?: boolean;          // CSS: `nome:` vira atributo
  jsonKeys?: boolean;       // JSON: "chave": vira atributo
  vars?: boolean;           // bash: $VAR
}

const CFG: Record<string, CLike> = {
  csharp: { line: ['//'], block: ['/*', '*/'], quotes: `"'`, keywords: KW_CSHARP },
  typescript: { line: ['//'], block: ['/*', '*/'], quotes: `"'\``, keywords: KW_TS },
  java: { line: ['//'], block: ['/*', '*/'], quotes: `"'`, keywords: KW_JAVA },
  css: { block: ['/*', '*/'], quotes: `"'`, keywords: KW_CSS, props: true },
  scss: { line: ['//'], block: ['/*', '*/'], quotes: `"'`, keywords: KW_CSS, props: true },
  json: { quotes: '"', keywords: KW_JSON, jsonKeys: true },
  sql: { line: ['--'], block: ['/*', '*/'], quotes: `'"`, doubledQuote: true, keywords: KW_SQL, ci: true },
  python: { line: ['#'], quotes: `"'`, keywords: KW_PY },
  bash: { line: ['#'], quotes: `"'`, keywords: KW_BASH, vars: true },
  vb: { line: ["'"], quotes: '"', doubledQuote: true, keywords: KW_VB, ci: true },
};

/** Estado entre linhas. */
interface State {
  block: boolean;          // dentro de comentário de bloco (linguagens C-like)
  asp: boolean;            // dentro de <% %>
  htmlComment: boolean;    // dentro de <!-- -->
  tag: boolean;            // dentro de uma tag HTML (<div ... >)
  quote: string | null;    // dentro de string de atributo HTML
  tagName: string;         // nome da tag aberta (para saber se é <script>/<style>)
  embedded: 'script' | 'style' | null; // dentro de <script>…</script> / <style>…</style>
  emb: { block: boolean } | null;      // estado do JS/CSS embutido
}

const newState = (): State => ({
  block: false, asp: false, htmlComment: false, tag: false, quote: null, tagName: '', embedded: null, emb: null,
});

const LANG_ALIASES: Record<string, HighlightLanguage> = {
  csharp: 'csharp', cs: 'csharp', 'c#': 'csharp', razor: 'html', cshtml: 'html',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  java: 'java', css: 'css', scss: 'scss', sass: 'scss', less: 'scss', json: 'json',
  sql: 'sql', tsql: 'sql', plsql: 'sql', python: 'python', py: 'python',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  html: 'html', htm: 'html', xml: 'html', config: 'html', svg: 'html',
  asp: 'asp', aspx: 'asp', inc: 'asp', vb: 'vb', vbnet: 'vb', vbs: 'vb', vbscript: 'vb',
};

/** Linguagem pelo nome que a skill mandou (`language`) ou pela extensão do caminho. */
export function normalizeLanguage(language?: string | null, path?: string | null): HighlightLanguage {
  const byName = LANG_ALIASES[(language ?? '').trim().toLowerCase()];
  if (byName) return byName;
  const ext = /\.([a-z0-9#]+)$/i.exec(path ?? '')?.[1]?.toLowerCase();
  return (ext && LANG_ALIASES[ext]) || 'plain';
}

/** Destaca as linhas (o estado de comentário/tag passa de uma para a outra). Uma string HTML por linha. */
export function highlightLines(lines: string[], language: HighlightLanguage | string | null | undefined): string[] {
  const lang = normalizeLanguage(language as string);
  const state = newState();
  return lines.map(line => highlightOne(line, lang, state));
}

/** Uma linha isolada (sem estado anterior). */
export function highlightLine(line: string, language: HighlightLanguage | string | null | undefined): string {
  return highlightOne(line, normalizeLanguage(language as string), newState());
}

function highlightOne(line: string, lang: HighlightLanguage, st: State): string {
  if (line.length > 4000) return esc(line); // linha gigante (minificado): sem destaque
  switch (lang) {
    case 'plain': return esc(line);
    case 'html': return scanHtml(line, st);
    case 'asp': return scanAsp(line, st);
    case 'javascript': return scanCLike(line, CFG['typescript'], st);
    default: return scanCLike(line, CFG[lang] ?? CFG['typescript'], st);
  }
}

// ── C-like (e SQL, Python, bash, VB, CSS, JSON) ─────────────────────────────────────────────────

const IDENT = /[A-Za-z_$@\p{L}][\w$\p{L}-]*/uy;
const IDENT_NO_DASH = /[A-Za-z_$@\p{L}][\w$\p{L}]*/uy;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/y;

function scanCLike(line: string, cfg: CLike, st: { block: boolean }): string {
  let out = '';
  let plain = '';
  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };
  let i = 0;
  const n = line.length;

  while (i < n) {
    // comentário de bloco aberto
    if (st.block && cfg.block) {
      const end = line.indexOf(cfg.block[1], i);
      flush();
      if (end < 0) { out += span('hl-c', line.slice(i)); return out; }
      out += span('hl-c', line.slice(i, end + cfg.block[1].length));
      i = end + cfg.block[1].length;
      st.block = false;
      continue;
    }
    const ch = line[i];
    // comentário de linha
    if (cfg.line?.some(p => line.startsWith(p, i)) && !(cfg.vars && i > 0 && !/\s/.test(line[i - 1]))) {
      flush();
      out += span('hl-c', line.slice(i));
      return out;
    }
    // REM do VB
    if (cfg === CFG['vb'] && /^rem\b/i.test(line.slice(i)) && (i === 0 || /\s/.test(line[i - 1]))) {
      flush();
      out += span('hl-c', line.slice(i));
      return out;
    }
    // comentário de bloco
    if (cfg.block && line.startsWith(cfg.block[0], i)) {
      flush();
      st.block = true;
      out += span('hl-c', cfg.block[0]);
      i += cfg.block[0].length;
      continue;
    }
    // string
    if (cfg.quotes.includes(ch)) {
      flush();
      let j = i + 1;
      while (j < n) {
        if (!cfg.doubledQuote && line[j] === '\\') { j += 2; continue; }
        if (line[j] === ch) {
          if (cfg.doubledQuote && line[j + 1] === ch) { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      const text = line.slice(i, Math.min(j, n));
      const isKey = cfg.jsonKeys && /^\s*:/.test(line.slice(j));
      out += span(isKey ? 'hl-a' : 'hl-s', text);
      i = Math.min(j, n);
      continue;
    }
    // $VAR / ${VAR} (bash)
    if (cfg.vars && ch === '$') {
      const m = /\$(?:\{[^}]*\}|[A-Za-z_][\w]*|[0-9#?@*$!-])/y;
      m.lastIndex = i;
      const r = m.exec(line);
      if (r) { flush(); out += span('hl-n', r[0]); i += r[0].length; continue; }
    }
    // número (não colado num identificador)
    if (/\d/.test(ch) && (i === 0 || !/[\w$]/.test(line[i - 1]))) {
      NUMBER.lastIndex = i;
      const r = NUMBER.exec(line);
      if (r) { flush(); out += span('hl-n', r[0]); i += r[0].length; continue; }
    }
    // identificador / palavra-chave / propriedade CSS
    if (/[A-Za-z_$@\p{L}]/u.test(ch) && (i === 0 || !/[\w$]/.test(line[i - 1]))) {
      const re = cfg.props ? IDENT : IDENT_NO_DASH;
      re.lastIndex = i;
      const r = re.exec(line);
      if (r) {
        const word = r[0];
        const bare = word.replace(/^[@$]/, '');
        const isKw = cfg.keywords.has(cfg.ci ? bare.toLowerCase() : bare) || (word.startsWith('@') && cfg.props);
        flush();
        // CSS: `nome:` no começo da declaração (e sem `{` depois — `a:hover {` é seletor)
        if (cfg.props && !isKw && /^\s*:(?!:)/.test(line.slice(i + word.length)) && !line.includes('{', i)
            && /^\s*$/.test(line.slice(0, i).replace(/.*[{;]/, ''))) {
          out += span('hl-a', word);
        } else {
          out += isKw ? span('hl-k', word) : esc(word);
        }
        i += word.length;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────────────

const TAG_NAME = /[A-Za-z][\w:.-]*/y;
const ATTR_NAME = /[^\s"'<>\/=]+/y;

function scanHtml(line: string, st: State): string {
  let out = '';
  let plain = '';
  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };
  let i = 0;
  const n = line.length;

  while (i < n) {
    // JS/CSS dentro de <script>/<style>: até a tag de fechamento
    if (st.embedded) {
      const close = line.toLowerCase().indexOf(`</${st.embedded}`, i);
      const code = close < 0 ? line.slice(i) : line.slice(i, close);
      flush();
      out += scanCLike(code, CFG[st.embedded === 'script' ? 'typescript' : 'css'], st.emb ??= { block: false });
      if (close < 0) return out;
      st.embedded = null;
      st.emb = null;
      i = close;
    }
    if (st.htmlComment) {
      const end = line.indexOf('-->', i);
      flush();
      if (end < 0) { out += span('hl-c', line.slice(i)); return out; }
      out += span('hl-c', line.slice(i, end + 3));
      i = end + 3;
      st.htmlComment = false;
      continue;
    }
    if (st.quote) {
      const end = line.indexOf(st.quote, i);
      flush();
      if (end < 0) { out += span('hl-s', line.slice(i)); return out; }
      out += span('hl-s', line.slice(i, end + 1));
      i = end + 1;
      st.quote = null;
      continue;
    }
    const ch = line[i];
    if (st.tag) {
      if (ch === '"' || ch === "'") { flush(); st.quote = ch; out += span('hl-s', ch); i++; continue; }
      if (ch === '>' || (ch === '/' && line[i + 1] === '>')) {
        flush();
        const t = ch === '>' ? '>' : '/>';
        out += span('hl-t', t);
        i += t.length;
        st.tag = false;
        if (t === '>' && (st.tagName === 'script' || st.tagName === 'style')) st.embedded = st.tagName;
        continue;
      }
      ATTR_NAME.lastIndex = i;
      const r = /[^\s"'<>\/=]/.test(ch) ? ATTR_NAME.exec(line) : null;
      if (r) { flush(); out += span('hl-a', r[0]); i += r[0].length; continue; }
      plain += ch;
      i++;
      continue;
    }
    if (line.startsWith('<!--', i)) {
      flush();
      st.htmlComment = true;
      out += span('hl-c', '<!--');
      i += 4;
      continue;
    }
    if (ch === '<' && /[A-Za-z\/!?]/.test(line[i + 1] ?? '')) {
      flush();
      let j = i + 1;
      if (line[j] === '/' || line[j] === '!' || line[j] === '?') j++;
      TAG_NAME.lastIndex = j;
      const r = TAG_NAME.exec(line);
      const end = r ? j + r[0].length : j;
      st.tagName = line[i + 1] === '/' ? '' : (r?.[0] ?? '').toLowerCase();
      out += span('hl-t', line.slice(i, end));
      i = end;
      st.tag = true;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

// ── ASP clássico: HTML + <% VBScript %> ─────────────────────────────────────────────────────────

function scanAsp(line: string, st: State): string {
  let out = '';
  let i = 0;
  const n = line.length;
  const vbState = newState();
  while (i < n) {
    if (st.asp) {
      const end = line.indexOf('%>', i);
      const code = end < 0 ? line.slice(i) : line.slice(i, end);
      out += scanCLike(code, CFG['vb'], vbState);
      if (end < 0) return out;
      out += span('hl-d', '%>');
      st.asp = false;
      i = end + 2;
      continue;
    }
    const start = line.indexOf('<%', i);
    const html = start < 0 ? line.slice(i) : line.slice(i, start);
    out += scanHtml(html, st);
    if (start < 0) return out;
    const delim = line.startsWith('<%=', start) ? '<%=' : line.startsWith('<%@', start) ? '<%@' : '<%';
    out += span('hl-d', delim);
    st.asp = true;
    i = start + delim.length;
  }
  return out;
}
