/**
 * Diagramas ```mermaid``` da Base Solvace (0033): a biblioteca vem do CDN só quando uma seção tem diagrama (não pesa
 * no bundle). Modo "strict" (sem scripts/HTML nos rótulos). Sem rede/CDN, o bloco continua como código.
 */
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
let loading: Promise<any> | null = null;
let seq = 0;

function loadMermaid(): Promise<any> {
  const w = window as any;
  if (w.mermaid) return Promise.resolve(w.mermaid);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_URL;
    script.async = true;
    script.onload = () => {
      w.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', fontFamily: 'inherit' });
      resolve(w.mermaid);
    };
    script.onerror = () => { loading = null; reject(new Error('mermaid indisponível')); };
    document.head.appendChild(script);
  });
  return loading;
}

/** Troca cada <pre><code class="language-mermaid"> dentro de `root` pelo diagrama (os demais ficam como estão). */
export async function renderMermaidIn(root: HTMLElement | null | undefined): Promise<void> {
  const blocks = Array.from(root?.querySelectorAll('pre > code.language-mermaid') ?? []) as HTMLElement[];
  if (!blocks.length) return;
  let mermaid: any;
  try { mermaid = await loadMermaid(); } catch { return; }
  for (const code of blocks) {
    const pre = code.parentElement!;
    if (!pre.isConnected) continue;
    try {
      const { svg } = await mermaid.render(`kb-mermaid-${++seq}`, code.textContent ?? '');
      const holder = document.createElement('div');
      holder.className = 'kb-diagram';
      holder.innerHTML = svg;
      pre.replaceWith(holder);
    } catch {
      pre.classList.add('kb-diagram--error');
      pre.title = 'Diagrama mermaid inválido — exibido como código';
    }
  }
}
