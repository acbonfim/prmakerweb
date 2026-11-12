import { Injectable } from '@angular/core';

/**
 * 0095 — "Ver tela ao vivo": o executor (prmake-agent) desta máquina transmite o navegador da skill validar-ambiente
 * só em 127.0.0.1. A Bancada lê direto dele (nada passa pela API nem é gravado); em outra máquina não há o que ler e o
 * botão não aparece. A porta é a padrão do executor (`liveViewPort` no config.json dele).
 * O Chrome pede uma vez a permissão "acessar apps e serviços neste dispositivo" (Local Network Access) — só para quem é
 * dono da execução (`mine`); negada, a Bancada não pergunta mais.
 */
export const LIVE_BROWSER_BASE = 'http://127.0.0.1:47615';
/** Sem executor nesta máquina (ou desligado): não pergunta de novo por este tempo. */
const OFFLINE_COOLDOWN_MS = 30_000;
const PROBE_TIMEOUT_MS = 1500;
/** Com a permissão ainda por decidir, a consulta espera a pessoa responder ao Chrome. */
const PROMPT_TIMEOUT_MS = 120_000;

/** Sessão do navegador aberta no executor local (`GET /live/sessions`). */
export interface LocalBrowserSession {
  sid: string;
  card: string | null;
  /** Sub-tarefa que abriu (ou reaproveitou) a sessão, sem o '#'. */
  task: string | null;
  env: string | null;
  label: string | null;
  readOnly: boolean;
  started: string | null;
  /** Caminho do MJPEG no executor (precisa do `token`). */
  stream: string;
}

export interface LocalBrowserList {
  /** Nome da máquina registrada no PRMake (o mesmo `workerName` do pedido). */
  worker: string | null;
  token: string;
  sessions: LocalBrowserSession[];
}

export interface LiveBrowserView {
  session: LocalBrowserSession;
  url: string;
}

/**
 * Sessão deste item: do mesmo card, na máquina que executa o pedido (quando o pedido diz qual é) e, se a sessão
 * guardou a sub-tarefa, de uma sub-tarefa deste item — senão outro item do mesmo card mostraria o botão também.
 */
export function pickBrowserSession(
  list: LocalBrowserList | null,
  card: string | null,
  workerName: string | null | undefined,
  taskNumbers: readonly number[]
): LocalBrowserSession | null {
  if (!list || !card) return null;
  if (workerName && list.worker && workerName.trim().toLowerCase() !== list.worker.trim().toLowerCase()) return null;
  const mine = list.sessions.filter((s) => (s.card ?? '').trim() === card.trim());
  const ofItem = (s: LocalBrowserSession) => !s.task || !taskNumbers.length || taskNumbers.includes(Number(s.task));
  return mine.filter(ofItem).sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''))[0] ?? null;
}

export function browserStreamUrl(list: LocalBrowserList, s: LocalBrowserSession): string {
  return `${LIVE_BROWSER_BASE}${s.stream}?t=${encodeURIComponent(list.token)}&v=${encodeURIComponent(s.started ?? '')}`;
}

@Injectable({ providedIn: 'root' })
export class LiveBrowserService {
  private offlineUntil = 0;
  private inflight: Promise<LocalBrowserList | null> | null = null;

  /** Sessões do executor local; null quando não há executor nesta máquina (ou ele recusou). Uma consulta por vez. */
  list(): Promise<LocalBrowserList | null> {
    if (Date.now() < this.offlineUntil || typeof fetch === 'undefined') return Promise.resolve(null);
    return (this.inflight ??= this.fetchList().finally(() => (this.inflight = null)));
  }

  private async fetchList(): Promise<LocalBrowserList | null> {
    const permission = await localNetworkPermission();
    if (permission === 'denied') {
      this.offlineUntil = Date.now() + OFFLINE_COOLDOWN_MS;
      return null;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), permission === 'prompt' ? PROMPT_TIMEOUT_MS : PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${LIVE_BROWSER_BASE}/live/sessions`, { signal: abort.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as LocalBrowserList;
      return { worker: body.worker ?? null, token: body.token, sessions: body.sessions ?? [] };
    } catch {
      this.offlineUntil = Date.now() + OFFLINE_COOLDOWN_MS;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Estado da permissão de rede local do Chrome (null quando o navegador não tem essa permissão — Safari, Firefox, Chrome antigo). */
async function localNetworkPermission(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions?.query({ name: 'local-network-access' as PermissionName });
    return status?.state ?? null;
  } catch {
    return null;
  }
}
