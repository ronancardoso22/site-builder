/*
  SEO DO SITE (20/11/2026) — usado pelas funções da pasta functions/.

  O site é uma página só (index.html) e os posts chegam depois, pelo JavaScript.
  O Google, o Discord e o WhatsApp leem o HTML que o servidor manda. Por isso a
  Cloudflare roda estas funções antes de entregar /, /builds, /guias, /novidades
  e /post/ID: elas pegam o index.html e colocam nele o título, a descrição, a
  prévia (Open Graph) e, nos posts, o texto do post.

  DOMÍNIO PRÓPRIO: quando tiver, troque só a linha URL_DO_SITE abaixo.
*/
export const URL_DO_SITE = 'https://drakbuilder.pages.dev';

// Os mesmos valores de supabase-config.js (a chave é a PÚBLICA; quem protege os dados é o RLS)
const SUPABASE_URL = 'https://tixxigsfgkcpnjccjbwd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BSocTOgkQ5U7r35Q8PVEcw_0ywdOFmT';

const NOME = 'Drakbuilder';
const IMAGEM_PADRAO = '/imagens/steam/ss01.jpg'; // 1920x1080, print oficial da Steam
const PREFIXO_IMG = SUPABASE_URL + '/storage/v1/object/public/imagens/';

export const PAGINAS = {
  '/': {
    titulo: 'Drakbuilder – Builds de Drakantos, guias e notícias',
    descricao: 'Drakbuilder: builds de Drakantos montadas por jogadores, com troféus, artefatos, orbes, prints e vídeo. Guias e notícias do jogo em português.',
    dadosEstruturados: true,
  },
  '/builds': {
    titulo: 'Builds de Drakantos · Drakbuilder',
    descricao: 'Todas as builds de Drakantos do Drakbuilder: troféus, artefatos e orbes de cada herói, montadas e testadas por jogadores.',
    tela: 'page-builds',
  },
  '/guias': {
    titulo: 'Guias de Drakantos · Drakbuilder',
    descricao: 'Guias de Drakantos em português: dicas, mecânicas e passo a passo para jogar melhor.',
    tela: 'page-guias',
  },
  '/novidades': {
    titulo: 'Notícias de Drakantos · Drakbuilder',
    descricao: 'Notícias e atualizações de Drakantos traduzidas para o português.',
    tela: 'page-novidades',
  },
};

export const idValido = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texto curto para a descrição: sem quebras de linha e no máximo ~160 letras
export function resumo(texto, max = 160) {
  const t = String(texto ?? '').replace(/\[(imagem|v[ií]deo)\s*\d+\]|\[youtube\]/gi, ' ').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// Imagem da prévia: só endereços que o próprio site aceita (mesmas regras do safeImageUrl do backend.js)
export function imagemDaPrevia(u) {
  if (typeof u !== 'string' || u.length > 500 || /["'<>`\s\\]/.test(u) || u.includes('..')) return URL_DO_SITE + IMAGEM_PADRAO;
  if (/^imagens\/[A-Za-z0-9/_.-]+\.(png|jpe?g|webp|gif)$/i.test(u)) return URL_DO_SITE + '/' + u;
  if (u.startsWith(PREFIXO_IMG) && /^[A-Za-z0-9/_.-]+$/.test(u.slice(PREFIXO_IMG.length))) return u;
  if (/^https:\/\/[a-z0-9.-]*(steamstatic\.com|steamusercontent\.com|akamaihd\.net)\//i.test(u)) return u;
  return URL_DO_SITE + IMAGEM_PADRAO; // data:, endereços estranhos etc.
}

// Busca no Supabase como visitante (só vê posts não suspensos, pelo RLS)
export async function supabase(caminho) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error('Supabase respondeu ' + r.status);
  return r.json();
}

export async function buscarPost(id) {
  if (!idValido(id)) return null;
  const linhas = await supabase(`posts?select=id,type,title,descr,sections,card_image,created_at,updated_at,autor:profiles!posts_author_id_fkey(name)&id=eq.${encodeURIComponent(id)}&suspended=is.false&limit=1`);
  return linhas[0] || null;
}

const TIPO = { builds: 'Build', guias: 'Guia', novidades: 'Notícia' };

// Texto do post em HTML simples (tudo escapado). O JavaScript troca pela página completa depois.
export function htmlDoPost(p) {
  const secoes = (Array.isArray(p.sections) ? p.sections : []).slice(0, 30).map(s => {
    const linhas = String(s?.content ?? '').split('\n').filter(l => !/^\s*\[(imagem\s+\d+|v[ií]deo\s+\d|youtube)\]\s*$/i.test(l));
    const paragrafos = linhas.join('\n').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
      .map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
    const itens = Array.isArray(s?.items) ? `<ul>${s.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
    const tabela = Array.isArray(s?.rows) ? `<ul>${s.rows.map(r => `<li>${esc(r?.k)}: ${esc(r?.v)}</li>`).join('')}</ul>` : '';
    return `<section><h2>${esc(s?.name)}</h2>${paragrafos}${itens}${tabela}</section>`;
  }).join('');
  const data = new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  return `<article class="post-pre-render" style="max-width:860px;margin:0 auto;padding:2rem 16px">
<p>${esc(TIPO[p.type] || 'Post')} · por ${esc(p.autor?.name || 'Usuário')} · ${esc(data)}</p>
<h1>${esc(p.title)}</h1>${p.descr ? `<p>${esc(p.descr)}</p>` : ''}${secoes}
<p>Carregando a página completa…</p></article>`;
}

// Tags do <head>: descrição, endereço oficial (canonical) e prévia de redes sociais
// Nome do site para o Google (aparece em cima do link nos resultados). Só na página inicial.
const DADOS_SITE = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'WebSite', name: NOME,
  alternateName: ['Drak Builder', 'Drakantos Builder'], url: URL_DO_SITE + '/', inLanguage: 'pt-BR',
}).replace(/</g, '\\u003c');

const SUFIXO_POST = { builds: ' – Build de Drakantos', guias: ' – Guia de Drakantos' }; // igual ao backend.js
export const tituloDoPost = p => `${p.title}${SUFIXO_POST[p.type] || ''} · ${NOME}`;

export function tagsDoHead({ titulo, descricao, caminho, imagem, tipo = 'website', semIndice = false, dadosEstruturados = false }) {
  const url = URL_DO_SITE + caminho;
  const img = imagem || URL_DO_SITE + IMAGEM_PADRAO;
  return [
    semIndice ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${NOME}">`,
    '<meta property="og:locale" content="pt_BR">',
    `<meta property="og:type" content="${tipo}">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(descricao)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(titulo)}">`,
    `<meta name="twitter:description" content="${esc(descricao)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    dadosEstruturados ? `<script type="application/ld+json">${DADOS_SITE}</script>` : '',
  ].filter(Boolean).join('\n  ');
}

// Os mesmos cabeçalhos de segurança do _headers (o _headers não vale para respostas de funções)
const SEGURANCA = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'", // o resto da regra está no <meta> do index.html
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/*
  Entrega o index.html com o SEO da página.
  pagina = { titulo, descricao, caminho, imagem?, tipo?, semIndice?, tela?, conteudo?, status? }
  tela = id da seção que já abre visível; conteudo = HTML (já escapado) que vai dentro dela.
*/
export async function entregarPagina(context, pagina) {
  const base = await context.env.ASSETS.fetch(new URL('/', context.request.url));
  let res = new HTMLRewriter()
    .on('title', { element: el => el.setInnerContent(pagina.titulo) })
    .on('meta[name="description"]', { element: el => el.setAttribute('content', pagina.descricao) })
    .on('head', { element: el => el.append('  ' + tagsDoHead(pagina) + '\n', { html: true }) });
  if (pagina.tela) {
    res = res
      .on('#page-home', { element: el => el.setAttribute('class', 'page') })
      .on('#' + pagina.tela, { element: el => {
        el.setAttribute('class', 'page active');
        if (pagina.conteudo) el.setInnerContent(pagina.conteudo, { html: true });
      } });
  }
  const saida = res.transform(base);
  const headers = new Headers(saida.headers);
  for (const [k, v] of Object.entries(SEGURANCA)) if (!headers.has(k)) headers.set(k, v); // não troca a regra mais completa do _headers, se vier
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  return new Response(saida.body, { status: pagina.status || 200, headers });
}
