import { CaseMessage } from './case-chat.model';

/**
 * Quando o especialista é chamado (espelho de `CaseMessage.AsksSpecialist` no servidor): com uma pessoa só na conversa,
 * toda mensagem; com duas ou mais, só a que menciona @especialista/@claude ou tem "?". "Só entre pessoas" nunca chama.
 */
export function callsSpecialist(m: Pick<CaseMessage, 'authorKind' | 'kind' | 'text' | 'transcript' | 'peopleOnly' | 'mentions'>,
  people: number): boolean {
  if (m.authorKind !== 'person' || m.peopleOnly) return false;
  if (people <= 1) return true;
  if ((m.mentions ?? []).some(isSpecialistMention) || /(?<![\w@])@(especialista|claude)\b/i.test(m.text ?? '')) return true;
  const content = m.kind === 'voice' ? m.transcript ?? '' : m.text ?? '';
  return content.includes('?');
}

export function isSpecialistMention(mention: string): boolean {
  const m = mention.toLowerCase();
  return m.startsWith('especialista') || m === 'claude';
}

/**
 * Mensagens de pessoas depois da última resposta do especialista que NÃO o chamaram — a tela marca "não chamou o
 * especialista" com o botão "Chamar". A regra vale com as pessoas que JÁ tinham falado até cada mensagem (como o
 * servidor conta na hora): a primeira mensagem de quem estava sozinho chamou, mesmo que outra pessoa tenha entrado
 * depois. `people` (participantes de agora) só desliga tudo quando a conversa tem uma pessoa só.
 */
export function silentTail(messages: readonly CaseMessage[], people: number): Set<string> {
  const silent = new Set<string>();
  if (people <= 1) return silent;
  const seen = new Set<string>();
  const peopleAt = messages.map((m) => {
    if (m.authorKind === 'person') seen.add((m.authorUserId || m.authorName || '').toLowerCase());
    return seen.size;
  });
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.authorKind === 'specialist') break;
    if (m.authorKind !== 'person' || m.peopleOnly) continue;
    if (callsSpecialist(m, peopleAt[i])) break;
    silent.add(m.id);
  }
  return silent;
}

/** Texto da caixa de mensagem: com 2+ pessoas, lembra como chamar o especialista. */
export function composerHint(people: number, working: boolean, short = false): string {
  if (working) return 'Escreva — ele lê quando terminar';
  if (people > 1) return short ? 'Pergunte com ? ou @especialista' : 'Pergunte com ? ou @especialista para chamar o especialista — / comandos, # item';
  return short ? 'Pergunte ao especialista…' : 'Pergunte ao especialista… (/ comandos, # item, @ menciona)';
}
