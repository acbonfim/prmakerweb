import {
  ARCHITECTURE_KINDS,
  ArchitectureProject,
  ArchitectureSectionSummary,
  isGuideSection,
  relationKind
} from '../../../services/architecture.service';

/**
 * Camada amigável da Base Solvace (feature 0038): nomes, tipos e ligações em linguagem simples para QA, gestores e
 * suporte. Tudo calculado no front a partir dos mesmos dados — a visão técnica continua igual (modo "Técnico").
 */

export type KbViewMode = 'simples' | 'tecnico';

/** Tipo de projeto em linguagem simples (modo Simples). */
export const FRIENDLY_KINDS: Record<string, { label: string; icon: string; hint: string }> = {
  ecosystem: { label: 'Visão geral', icon: 'hub', hint: 'Como as partes do Solvace se encaixam.' },
  legacy: { label: 'Sistema legado', icon: 'account_tree', hint: 'A versão antiga do Solvace (edv-solvace), ainda em uso.' },
  frontend: { label: 'Telas (front-end)', icon: 'web', hint: 'A parte que a pessoa vê e usa: as telas.' },
  integration: { label: 'Integrações', icon: 'swap_horiz', hint: 'O que liga o Solvace a outros sistemas.' },
  revamp: { label: 'Sistema novo (revamp)', icon: 'view_module', hint: 'A nova geração dos módulos do Solvace.' },
  infra: { label: 'Infraestrutura', icon: 'cloud', hint: 'Servidores, nuvem e peças que mantêm tudo no ar.' },
  auth: { label: 'Login e acesso', icon: 'lock', hint: 'Quem pode entrar e o que cada pessoa pode fazer.' },
  'third-party': { label: 'Serviço de terceiros', icon: 'extension', hint: 'Serviço de outra empresa que o Solvace usa.' },
  'business-rules': { label: 'Regras de negócio', icon: 'gavel', hint: 'Como o produto deve se comportar.' },
  other: { label: 'Outros', icon: 'folder', hint: '' }
};

export function friendlyKind(kind: string) {
  return FRIENDLY_KINDS[kind] ?? FRIENDLY_KINDS['other'];
}

/** "Revamp — Action Plan" → "Action Plan" (prefixos técnicos saem); displayName ganha sempre. */
export function friendlyName(p: Pick<ArchitectureProject, 'name' | 'displayName'> | null | undefined): string {
  if (!p) return '';
  const display = p.displayName?.trim();
  if (display) return display;
  return stripTechPrefix(p.name);
}

export function stripTechPrefix(name: string): string {
  const stripped = name.replace(/^(Revamp( infra)?|Legado|Legacy|Front-?end|Integra(ç|c)(ão|ao|ões)|Infra(estrutura)?|Servi(ç|c)o externo|Auth|Login)\s+[—–-]\s+/i, '').trim();
  return stripped || name;
}

/** Frase para leigo: tagline; senão a primeira frase do resumo. */
export function friendlyTagline(p: Pick<ArchitectureProject, 'tagline' | 'summary'> | null | undefined): string {
  if (!p) return '';
  return p.tagline?.trim() || firstSentence(p.summary ?? '');
}

export function firstSentence(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').replace(/[`*_]/g, '').trim();
  if (!clean) return '';
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const first = (m ? m[1] : clean).trim();
  return first.length > max ? first.slice(0, max - 1).trimEnd() + '…' : first;
}

/** Área de negócio do projeto; sem área, o tipo amigável agrupa. */
export function projectArea(p: ArchitectureProject): string {
  return p.businessArea?.trim() || friendlyKind(p.kind).label;
}

export interface AreaGroup {
  area: string;
  icon: string;
  /** true = veio do businessArea; false = agrupado pelo tipo (sem área cadastrada). */
  business: boolean;
  projects: ArchitectureProject[];
}

/** Projetos agrupados por área de negócio (com área primeiro, A→Z), depois pelos tipos amigáveis na ordem de sempre. */
export function areaGroups(projects: ArchitectureProject[]): AreaGroup[] {
  const map = new Map<string, AreaGroup>();
  for (const p of projects) {
    const business = !!p.businessArea?.trim();
    const area = projectArea(p);
    const g = map.get(area) ?? { area, icon: business ? 'business_center' : friendlyKind(p.kind).icon, business, projects: [] };
    g.projects.push(p);
    map.set(area, g);
  }
  const kindOrder = (g: AreaGroup) => {
    const kind = Object.entries(FRIENDLY_KINDS).find(([, v]) => v.label === g.area)?.[0] ?? 'other';
    const i = ARCHITECTURE_KINDS.findIndex(k => k.kind === kind);
    return i < 0 ? 99 : i;
  };
  for (const g of map.values()) g.projects.sort((a, b) => friendlyName(a).localeCompare(friendlyName(b)));
  return [...map.values()].sort((a, b) =>
    Number(b.business) - Number(a.business) || (a.business ? a.area.localeCompare(b.area) : kindOrder(a) - kindOrder(b)));
}

/** 0054: o Guia (Simples) — a visão prática da engenharia reversa vem primeiro; o Guia antigo que ela substituiu sai. */
export function guideSections(p: ArchitectureProject | null | undefined): ArchitectureSectionSummary[] {
  const superseded = p?.supersededSections ?? {};
  return (p?.sections ?? []).filter(isGuideSection).filter(s => !superseded[s.key])
    .sort((a, b) => (a.key === 're-pratica' ? -1 : b.key === 're-pratica' ? 1 : a.order - b.order));
}

export function techSections(p: ArchitectureProject | null | undefined): ArchitectureSectionSummary[] {
  return (p?.sections ?? []).filter(s => !isGuideSection(s));
}

/** ext:microsoft-graph → Microsoft Graph (o backend manda o nome no grafo; aqui só para o painel do projeto). */
export function externalName(key: string): string {
  if (!key.startsWith('ext:')) return key;
  const names: Record<string, string> = {
    'ext:microsoft-graph': 'Microsoft Graph / Teams', 'ext:azure-ad': 'Azure AD / Entra ID', 'ext:openai': 'OpenAI', 'ext:anthropic': 'Anthropic',
    'ext:gemini': 'Google Gemini', 'ext:hubspot': 'HubSpot', 'ext:azure-devops': 'Azure DevOps', 'ext:powerbi': 'Power BI',
    'ext:snowflake': 'Snowflake', 'ext:databricks': 'Databricks', 'ext:cognito': 'AWS Cognito', 'ext:s3': 'AWS S3', 'ext:sqs': 'AWS SQS',
    'ext:opensearch': 'OpenSearch', 'ext:onlyoffice': 'OnlyOffice'
  };
  return names[key] ?? key.slice(4);
}

// ── "Com quem conversa" em frases ─────────────────────────────────────────────────────────────────

export interface ConnectionTarget {
  key: string;
  name: string;
  mapped: boolean;
  /** Detalhe técnico (o que o código mostra) — vai no tooltip. */
  tip: string;
}

export interface ConnectionSentence {
  kind: string;
  icon: string;
  color: string;
  pre: string;
  targets: ConnectionTarget[];
  post: string;
  /** Termo técnico entre parênteses (com glossário no tooltip). */
  tag: string;
}

/** Frase por tipo de ligação: "depende de" (o sistema faz) e "usado por" (os outros fazem com ele). */
const SENTENCES: Record<string, { out: [string, string]; in: [string, string, string]; tag: string }> = {
  event: { out: ['Avisa ', ' quando algo acontece'], in: [' avisa este sistema quando algo acontece', ' avisam este sistema quando algo acontece', ''], tag: 'mensagem de evento' },
  queue: { out: ['Manda tarefas para ', ' processar em segundo plano'], in: [' manda tarefas para este sistema processar em segundo plano', ' mandam tarefas para este sistema processar em segundo plano', ''], tag: 'fila' },
  http: { out: ['Chama ', ' diretamente'], in: [' chama este sistema diretamente', ' chamam este sistema diretamente', ''], tag: 'chamada direta pela API' },
  database: { out: ['Usa os mesmos dados que ', ''], in: [' usa os mesmos dados que este sistema', ' usam os mesmos dados que este sistema', ''], tag: 'banco compartilhado' },
  package: { out: ['Usa peças de código de ', ''], in: [' usa peças de código deste sistema', ' usam peças de código deste sistema', ''], tag: 'pacote' },
  external: { out: ['Usa o serviço externo ', ''], in: [' usa este sistema como serviço externo', ' usam este sistema como serviço externo', ''], tag: 'serviço externo' },
  frontend: { out: ['É a tela de ', ''], in: [' é a tela deste sistema', ' são as telas deste sistema', ''], tag: 'front-end' },
  other: { out: ['Tem outra ligação com ', ''], in: [' tem outra ligação com este sistema', ' têm outra ligação com este sistema', ''], tag: '' }
};

const KIND_ORDER = ['frontend', 'http', 'event', 'queue', 'database', 'external', 'package', 'other'];

export function buildConnections(project: ArchitectureProject | null, projects: ArchitectureProject[]): { out: ConnectionSentence[]; in: ConnectionSentence[]; count: number } {
  if (!project) return { out: [], in: [], count: 0 };
  const byKey = new Map(projects.map(p => [p.key, p]));
  const target = (key: string): Omit<ConnectionTarget, 'tip'> => {
    const p = byKey.get(key);
    return { key, name: p ? friendlyName(p) : externalName(key), mapped: !!p };
  };
  const group = (list: { other: string; kind: string; detail?: string | null; evidence?: string | null }[], incoming: boolean) => {
    const map = new Map<string, Map<string, { t: Omit<ConnectionTarget, 'tip'>; tips: string[] }>>();
    for (const r of list) {
      const kind = SENTENCES[r.kind] ? r.kind : 'other';
      const targets = map.get(kind) ?? new Map();
      const item = targets.get(r.other) ?? { t: target(r.other), tips: [] };
      const tip = [r.detail, r.evidence ? `evidência: ${r.evidence}` : null].filter(Boolean).join(' — ');
      if (tip) item.tips.push(tip);
      targets.set(r.other, item);
      map.set(kind, targets);
    }
    return KIND_ORDER.filter(k => map.has(k)).map<ConnectionSentence>(kind => {
      const s = SENTENCES[kind];
      const rel = relationKind(kind);
      const targets = [...map.get(kind)!.values()]
        .map(x => ({ ...x.t, tip: `${rel.label}${x.tips.length ? '\n' + x.tips.slice(0, 6).join('\n') : ''}` }))
        .sort((a, b) => Number(b.mapped) - Number(a.mapped) || a.name.localeCompare(b.name));
      return incoming
        ? { kind, icon: rel.icon, color: rel.color, pre: '', targets, post: targets.length > 1 ? s.in[1] : s.in[0], tag: s.tag }
        : { kind, icon: rel.icon, color: rel.color, pre: s.out[0], targets, post: s.out[1], tag: s.tag };
    });
  };
  const out = group((project.relations ?? []).map(r => ({ other: r.target, ...r })), false);
  const inc = group((project.usedBy ?? []).map(r => ({ other: r.source, ...r })), true);
  const others = new Set([...(project.relations ?? []).map(r => r.target), ...(project.usedBy ?? []).map(r => r.source)]);
  return { out, in: inc, count: others.size };
}

/** Rótulo curto da ligação no mapa simplificado (em português). */
export const FRIENDLY_EDGE: Record<string, { label: string; panel: string }> = {
  event: { label: 'avisa', panel: 'Avisa quando algo acontece (evento)' },
  queue: { label: 'manda tarefa', panel: 'Manda tarefas para processar depois (fila)' },
  http: { label: 'chama', panel: 'Chama diretamente (API)' },
  database: { label: 'mesmos dados', panel: 'Usa os mesmos dados (banco compartilhado)' },
  package: { label: 'usa código', panel: 'Usa peças de código (pacote)' },
  external: { label: 'usa', panel: 'Usa o serviço externo' },
  frontend: { label: 'tela de', panel: 'É a tela de' },
  other: { label: 'ligado', panel: 'Outra ligação' }
};

export function friendlyEdge(kind: string) {
  return FRIENDLY_EDGE[kind] ?? FRIENDLY_EDGE['other'];
}

// ── Glossário (tooltips em termos técnicos) ───────────────────────────────────────────────────────

export interface GlossaryEntry { term: string; pattern: string; definition: string; }

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'Fila (SQS)', pattern: 'SQS|filas?', definition: 'Fila de mensagens: um sistema deixa uma tarefa na fila e outro a processa depois, em segundo plano. Se quem processa estiver fora do ar, a tarefa espera na fila.' },
  { term: 'Evento (SNS)', pattern: 'SNS|mensagens? de evento|eventos?', definition: 'Aviso de que algo aconteceu (ex.: "plano criado"). Quem assina o aviso recebe uma cópia e reage — quem avisa não precisa saber quem está escutando.' },
  { term: 'Lambda', pattern: 'Lambdas?', definition: 'Pequeno programa na nuvem (AWS) que roda sozinho quando é chamado ou quando chega uma mensagem — sem um servidor ligado o tempo todo.' },
  { term: 'API', pattern: 'APIs?', definition: 'A "porta de entrada" de um sistema: é por ela que as telas e outros sistemas pedem dados ou ações.' },
  { term: 'Endpoint', pattern: 'endpoints?', definition: 'Um endereço específico da API que faz uma coisa só (ex.: "criar plano de ação").' },
  { term: 'Cognito', pattern: 'Cognito', definition: 'Serviço da AWS que cuida do login: guarda os usuários e confirma quem é quem.' },
  { term: 'Banco de dados', pattern: 'bancos? de dados|bancos? compartilhados?|bancos?', definition: 'Onde as informações ficam guardadas. "Banco compartilhado" = dois sistemas lendo e gravando os mesmos dados — mudar de um lado pode afetar o outro.' },
  { term: 'Job / rotina', pattern: 'jobs?|rotinas?', definition: 'Tarefa automática que roda sozinha em horários definidos ou de tempos em tempos (ex.: enviar lembretes toda noite).' },
  { term: 'SignalR', pattern: 'SignalR', definition: 'Tecnologia que atualiza a tela em tempo real, sem precisar recarregar a página.' },
  { term: 'HTTP / chamada direta', pattern: 'HTTP|chamada direta', definition: 'Um sistema chama o outro diretamente e espera a resposta na hora. Se o outro estiver fora do ar, a ação falha.' },
  { term: 'Front-end', pattern: 'front-?end|telas', definition: 'A parte que a pessoa vê e usa: as telas no navegador.' },
  { term: 'Revamp', pattern: 'revamp', definition: 'A nova geração dos módulos do Solvace (sistemas reescritos).' },
  { term: 'Legado', pattern: 'legado', definition: 'A versão antiga do Solvace (edv-solvace), que ainda atende várias partes do produto.' },
  { term: 'Pacote', pattern: 'pacotes?', definition: 'Peça de código pronta, compartilhada entre vários sistemas.' },
  { term: 'Webhook', pattern: 'webhooks?', definition: 'Aviso automático que um sistema manda para outro, por um endereço da internet, quando algo acontece.' },
  { term: 'S3', pattern: 'S3', definition: 'Armazenamento de arquivos da AWS (anexos, imagens, documentos).' },
  { term: 'Serviço externo', pattern: 'servi(ç|c)os? externos?|terceiros', definition: 'Serviço de outra empresa (ex.: Microsoft, OpenAI) que o Solvace usa pela internet.' }
];

const GLOSSARY_RE = new RegExp(`(?<![\\p{L}\\d])(${GLOSSARY.map(g => `(?:${g.pattern})`).join('|')})(?![\\p{L}\\d])`, 'giu');

export interface GlossSegment { text: string; tip?: string; }

/** Divide o texto marcando a primeira ocorrência de cada termo do glossário (tooltip com a definição). */
export function glossarySegments(text: string): GlossSegment[] {
  if (!text) return [];
  const out: GlossSegment[] = [];
  const used = new Set<GlossaryEntry>();
  let last = 0;
  for (const m of text.matchAll(GLOSSARY_RE)) {
    const entry = GLOSSARY.find(g => new RegExp(`^(?:${g.pattern})$`, 'iu').test(m[0]));
    if (!entry || used.has(entry)) continue;
    used.add(entry);
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], tip: `${entry.term}: ${entry.definition}` });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function glossaryTip(text: string): string {
  return glossarySegments(text).filter(s => s.tip).map(s => s.tip).join('\n\n');
}

// ── Sumário da seção e artigo do KC ───────────────────────────────────────────────────────────────

export interface TocItem { level: 2 | 3; text: string; }

/** Títulos ## e ### do markdown (fora de blocos de código) — o sumário da seção. */
export function headingsOf(markdown: string | null | undefined): TocItem[] {
  if (!markdown) return [];
  const items: TocItem[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (m) items.push({ level: m[1].length as 2 | 3, text: cleanInline(m[2]) });
  }
  return items;
}

export function cleanInline(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, '').trim();
}

/**
 * Texto do artigo do Knowledge Center (texto corrido, sem markdown) → markdown leve: listas com •/-/1., subtítulos
 * curtos sem pontuação final, "Rótulo:" em negrito. Se o artigo já vem em markdown, fica como está.
 */
export function articleMarkdown(content: string | null | undefined): string {
  if (!content) return '';
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)/m.test(content)) return content;
  const text = content.replace(/\r/g, '').replace(/(?<=[.!?])[ \t]{2,}/g, '\n\n');
  const lines = text.split('\n').map(l => l.trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { out.push(''); continue; }
    const bullet = line.match(/^[•▪◦·●‣–—]\s*(.+)$/);
    if (bullet) { pushListItem(out, `- ${bullet[1]}`); continue; }
    const numbered = line.match(/^(\d+)\s*[.)-]\s+(.+)$/);
    if (numbered) { pushListItem(out, `${numbered[1]}. ${numbered[2]}`); continue; }
    const next = lines[i + 1] ?? '';
    const words = line.split(/\s+/).length;
    const isHeading = line.length <= 70 && words <= 9 && !/[.,;!?]$/.test(line) && !!next && (i === 0 || !lines[i - 1] || /[.!?:]$/.test(lines[i - 1]));
    if (/:$/.test(line) && line.length <= 90) { out.push('', `**${line}**`); continue; }
    if (isHeading && i > 0) { out.push('', `### ${line}`, ''); continue; }
    if (out.length && out[out.length - 1] && !/^(- |\d+\. |### |\*\*)/.test(out[out.length - 1])) out.push('');
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function pushListItem(out: string[], item: string): void {
  const prev = out[out.length - 1];
  if (prev && !/^(- |\d+\. )/.test(prev)) out.push('');
  out.push(item);
}

/** Conteúdo da sugestão enviada para a fila (título em negrito na primeira linha; Guia avisado). */
export function suggestionContent(title: string, audience: string, content: string): string {
  const head = title.trim() ? `**${title.trim()}**\n` : '';
  const aud = audience === 'human' ? 'Público: Guia (linguagem simples)\n' : '';
  return `${head}${aud}${head || aud ? '\n' : ''}${content.trim()}`;
}

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
