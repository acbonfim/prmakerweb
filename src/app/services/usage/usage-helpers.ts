import { UsageClientInfo } from './usage.model';

/** Ids numéricos, GUIDs e hashes longos das rotas viram `:id` (o card fica no campo próprio). */
export function normalizePath(path: string): string {
  const clean = (path || '/').split(/[?#]/)[0];
  return clean
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
      if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
      if (seg.length > 40) return ':id';
      return seg;
    })
    .join('/');
}

export function cut(value: string | null | undefined, max: number): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.length <= max ? v : v.slice(0, max - 1) + '…';
}

/** Área amigável de cada controller da API (para ações, "ocupado" e análise). */
const AREA_LABELS: Record<string, string> = {
  ai: 'IA',
  aiusage: 'Consumo de IA',
  architecture: 'Base Solvace',
  knowledge: 'Base Solvace',
  reverseengineering: 'Engenharia reversa',
  executionplan: 'Plano de execução',
  executionqueue: 'Fila do executor',
  executionworker: 'Executores',
  pullrequest: 'Pull Request',
  github: 'GitHub',
  azure: 'Azure DevOps',
  devops: 'Azure DevOps',
  timeline: 'Linha do tempo',
  handover: 'Passagem de conhecimento',
  form: 'Formulários',
  pluginconfiguration: 'Plugins',
  promotion: 'Promoção de PRs',
  teams: 'Teams',
  image: 'Imagem',
  userintegration: 'Integrações pessoais',
  skills: 'Skills',
  textcenter: 'Central de textos',
  cardassistant: 'Assistente do card',
  vacations: 'Férias',
  user: 'Usuários',
  service: 'Serviços',
  password: 'Senha',
  oauth: 'Login',
  integration: 'Chave de integração',
};

/** `POST https://api/.../api/v1/ExecutionPlan/123/answer?x=1` → `{ area: 'Plano de execução', name: 'POST ExecutionPlan/:id/answer' }`. */
export function describeEndpoint(method: string, url: string, bases: string[]): { area: string; name: string; path: string } {
  let path = url;
  for (const base of bases) {
    if (base && url.startsWith(base)) {
      path = url.slice(base.length);
      break;
    }
  }
  path = path.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?(api\/)?(v\d+(\.\d+)?\/)?/i, '');
  path = normalizePath(path).replace(/^\/+/, '');
  const first = (path.split('/')[0] || '').toLowerCase();
  const area = AREA_LABELS[first] ?? (path.split('/')[0] || 'API');
  return { area, name: cut(`${method.toUpperCase()} ${path}`, 120) ?? method, path };
}

/** Navegador, sistema e dispositivo (parse simples do user agent; `userAgentData` quando houver). */
export function clientInfo(): UsageClientInfo {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean; brands?: { brand: string; version: string }[] } };
  const ua = nav.userAgent || '';
  let browser = 'Outro';
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg\/(\d+)/))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/OPR\/(\d+)/))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/Firefox\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Version\/(\d+)(?:\.\d+)*.*Safari/))) browser = `Safari ${m[1]}`;

  let os = 'Outro';
  const platform = nav.userAgentData?.platform ?? '';
  if (/Windows/i.test(ua) || /Windows/i.test(platform)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = `iOS${(ua.match(/OS (\d+)_/) ?? [])[1] ? ' ' + (ua.match(/OS (\d+)_/) ?? [])[1] : ''}`;
  else if (/Android/i.test(ua)) os = `Android${(ua.match(/Android (\d+)/) ?? [])[1] ? ' ' + (ua.match(/Android (\d+)/) ?? [])[1] : ''}`;
  else if (/Mac OS X|Macintosh/i.test(ua)) os = navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let device = 'Desktop';
  if (nav.userAgentData?.mobile || /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua)) device = 'Celular';
  else if (/iPad|Tablet|Android/i.test(ua) || os === 'iPadOS') device = 'Tablet';

  const dpr = window.devicePixelRatio && window.devicePixelRatio !== 1 ? ` @${Math.round(window.devicePixelRatio * 100) / 100}x` : '';
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch { /* navegador antigo */ }

  return {
    browser,
    os,
    device,
    screenSize: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}${dpr}`,
    language: navigator.language || '',
    timeZone,
    appVersion: appVersion(),
  };
}

/** Versão do app = hash do bundle principal (muda a cada deploy); "dev" no `ng serve`. */
function appVersion(): string {
  const script = Array.from(document.scripts).find((s) => /\/main(-[A-Z0-9]+)?\.js/i.test(s.src));
  const hash = script?.src.match(/main-([A-Z0-9]+)\.js/i)?.[1];
  return hash ? hash.slice(0, 8) : 'dev';
}

/** Rótulo legível de um elemento clicado (aria-label, tooltip, title ou texto sem os ícones). */
export function clickLabel(el: Element): string | null {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return cut(aria, 80);
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    for (const id of describedBy.split(/\s+/)) {
      const text = document.getElementById(id)?.textContent;
      if (text?.trim()) return cut(text, 80);
    }
  }
  const title = el.getAttribute('title') || el.getAttribute('mattooltip');
  if (title?.trim()) return cut(title, 80);
  const text = textWithoutIcons(el);
  if (text) return cut(text, 80);
  const icon = el.querySelector('mat-icon, .material-icons')?.textContent?.trim();
  return icon ? `ícone: ${icon}` : null;
}

function textWithoutIcons(el: Element): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
    else if (node instanceof Element && !node.matches('mat-icon, .material-icons, .mat-icon, svg, input, textarea, select')) {
      out += ' ' + textWithoutIcons(node);
    }
  });
  return out.replace(/\s+/g, ' ').trim();
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
