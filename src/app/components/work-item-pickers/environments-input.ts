/**
 * 0092 — lógica pura do campo de **ambientes** da validação (sem Angular, testada em environments-input.spec.ts): o valor
 * é a lista separada por vírgula ("dev, qa, https://x.solvacelabs.com"); as opções do catálogo viram chips e um valor
 * livre (nome ou URL) entra pelo "Outro ambiente".
 */

/** Valores da lista (vírgula ou ponto-e-vírgula), sem vazios nem repetidos (sem diferenciar maiúsculas). */
export function splitEnvironments(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of `${value ?? ''}`.split(/[,;]/)) {
    const v = raw.trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

export function joinEnvironments(values: readonly string[]): string {
  return splitEnvironments(values.join(',')).join(', ');
}

export function hasEnvironment(value: string | null | undefined, env: string): boolean {
  const e = `${env ?? ''}`.trim().toLowerCase();
  return !!e && splitEnvironments(value).some((x) => x.toLowerCase() === e);
}

/** Liga/desliga um ambiente mantendo a ordem dos que já estavam. */
export function toggleEnvironment(value: string | null | undefined, env: string): string {
  const e = `${env ?? ''}`.trim();
  if (!e) return joinEnvironments(splitEnvironments(value));
  const list = splitEnvironments(value);
  return hasEnvironment(value, e)
    ? joinEnvironments(list.filter((x) => x.toLowerCase() !== e.toLowerCase()))
    : joinEnvironments([...list, e]);
}

/** Acrescenta um ou mais valores livres (o campo aceita "a, b"). */
export function addEnvironments(value: string | null | undefined, extra: string | null | undefined): string {
  return joinEnvironments([...splitEnvironments(value), ...splitEnvironments(extra)]);
}

/** Valores da lista que não são opções do catálogo (aparecem como chips "outro", removíveis). */
export function customEnvironments(value: string | null | undefined, options: readonly { value: string }[]): string[] {
  const known = new Set(options.map((o) => `${o.value ?? ''}`.trim().toLowerCase()));
  return splitEnvironments(value).filter((v) => !known.has(v.toLowerCase()));
}

/** Rótulo de um valor: o da opção cujo `value` bate, senão o próprio valor. */
export function environmentLabel(env: string, options: readonly { value: string; label?: string | null }[]): string {
  const e = `${env ?? ''}`.trim().toLowerCase();
  const hit = options.find((o) => `${o.value ?? ''}`.trim().toLowerCase() === e);
  return `${hit?.label ?? ''}`.trim() || `${env ?? ''}`.trim();
}
