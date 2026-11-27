import { CaseChoice, CaseChoicePick, CaseMessage } from './case-chat.model';

/** 0107: dá para enviar — alguma opção marcada (uma só, fora do checklist) ou outra resposta escrita. */
export function canSendChoice(choice: CaseChoice, picked: string[], other: string): boolean {
  const text = choice.allowOther ? other.trim() : '';
  const known = picked.filter((id) => choice.options.some((o) => o.id === id));
  if (choice.mode === 'multi') return known.length > 0 || text.length > 0;
  return (known.length === 1 && !text) || (known.length === 0 && text.length > 0);
}

/** O que vai para a API: as opções marcadas (na ordem da escolha) e a outra resposta, se houver. */
export function choicePick(choice: CaseChoice, picked: string[], other: string): CaseChoicePick {
  const text = choice.allowOther ? other.trim() : '';
  const selected = choice.options.filter((o) => picked.includes(o.id)).map((o) => o.id);
  return choice.mode === 'multi' ? { selected, other: text || null } : text ? { selected: [], other: text } : { selected: selected.slice(0, 1), other: null };
}

/** A escolha ainda espera um clique (sem resposta e não substituída). */
export function choiceOpen(m: Pick<CaseMessage, 'choice'>): boolean {
  return !!m.choice && !m.choice.answer && !m.choice.closedAt;
}
