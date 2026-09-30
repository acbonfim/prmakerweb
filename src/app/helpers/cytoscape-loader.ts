/**
 * Mapa do ecossistema da Base Solvace (0034): o cytoscape vem do CDN só quando o mapa é aberto (não pesa no bundle),
 * como o mermaid. Sem rede/CDN a tela mostra a lista de relações no lugar do grafo.
 */
const CYTOSCAPE_URL = 'https://cdn.jsdelivr.net/npm/cytoscape@3.34.3/dist/cytoscape.min.js';
let loading: Promise<any> | null = null;

export function loadCytoscape(): Promise<any> {
  const w = window as any;
  if (w.cytoscape) return Promise.resolve(w.cytoscape);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CYTOSCAPE_URL;
    script.async = true;
    script.onload = () => (w.cytoscape ? resolve(w.cytoscape) : reject(new Error('cytoscape indisponível')));
    script.onerror = () => { loading = null; reject(new Error('cytoscape indisponível')); };
    document.head.appendChild(script);
  });
  return loading;
}
