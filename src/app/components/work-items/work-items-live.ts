import { WsService } from '../../services/ws.service';
import { WORK_ITEMS_EVENT, WorkItemsUpdatedPayload } from './work-item.model';

/** 0100: o retrato da AWS do card mudou (PUT AwsDeploy/card/{card}) — mesmo grupo/evento, `action: "aws"`. */
export const AWS_ACTION = 'aws';

/**
 * 0085: escuta o tempo real dos itens de um card (grupo `execplan:{card}`, evento `workItemsUpdated`). O payload é só
 * sinal: quem escuta refaz o GET (com um debounce curto, para rajadas de eventos virarem um GET só). A volta da conexão
 * (`_resynced`) também recarrega — os eventos da queda se perderam. Devolve a função que desliga (off + sai do grupo).
 * `accept` filtra os eventos; por padrão ignora `action: "aws"` (0100: retrato da AWS — não muda os itens).
 */
export function listenWorkItems(
  ws: WsService,
  card: string,
  reload: (payload: WorkItemsUpdatedPayload | null) => void,
  debounceMs = 250,
  accept: (payload: WorkItemsUpdatedPayload) => boolean = (p) => p?.action !== AWS_ACTION
): () => void {
  const group = `execplan:${card}`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: WorkItemsUpdatedPayload | null = null;
  let stopped = false;

  const schedule = (payload: WorkItemsUpdatedPayload | null) => {
    if (stopped) return;
    // Vários eventos no intervalo: o recarregamento vale para todos (payload nulo = "recarregue tudo").
    last = timer ? null : payload;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) reload(last);
    }, debounceMs);
  };

  const handler = (payload: WorkItemsUpdatedPayload) => {
    if (payload?.cardNumber && `${payload.cardNumber}`.trim() !== card.trim()) return;
    if (payload && !accept(payload)) return;
    schedule(payload ?? null);
  };

  ws.startConnection();
  ws.on(WORK_ITEMS_EVENT, handler);
  ws.addToGroup(group);
  const resynced = ws._resynced.subscribe(() => schedule(null));

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    ws.off(WORK_ITEMS_EVENT, handler);
    ws.removeFromGroup(group);
    resynced.unsubscribe();
  };
}

/** 0100: só o retrato da AWS do card (`action: "aws"`) e a volta da conexão — a aba AWS recarrega o GET. */
export function listenAws(ws: WsService, card: string, reload: () => void, debounceMs = 400): () => void {
  return listenWorkItems(ws, card, () => reload(), debounceMs, (p) => p?.action === AWS_ACTION);
}
