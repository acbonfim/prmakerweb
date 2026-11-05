import { WsService } from '../../services/ws.service';
import { WORK_ITEMS_EVENT, WorkItemsUpdatedPayload } from './work-item.model';

/**
 * 0085: escuta o tempo real dos itens de um card (grupo `execplan:{card}`, evento `workItemsUpdated`). O payload é só
 * sinal: quem escuta refaz o GET (com um debounce curto, para rajadas de eventos virarem um GET só). A volta da conexão
 * (`_resynced`) também recarrega — os eventos da queda se perderam. Devolve a função que desliga (off + sai do grupo).
 */
export function listenWorkItems(
  ws: WsService,
  card: string,
  reload: (payload: WorkItemsUpdatedPayload | null) => void,
  debounceMs = 250
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
