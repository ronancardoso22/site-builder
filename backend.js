/*
  ════════════════════════════════════════════════════════════════
  BACKEND.JS — LÓGICA PRINCIPAL DO SITE DRAKANTOS
  ════════════════════════════════════════════════════════════════
  Este arquivo controla TUDO que acontece no site:
  - Login e cadastro de usuários
  - Criação, edição e exclusão de posts
  - Navegação entre páginas
  - Renderização do conteúdo na tela

  POR QUE "backend" se é JavaScript no browser?
  → Normalmente, "backend" seria um servidor separado (Node.js, Python, etc.)
    com banco de dados real. Neste site, como não há servidor, o "backend"
    roda no próprio browser do usuário, usando localStorage como banco de dados.
    É uma escolha deliberada para manter o site simples e sem infraestrutura.

  POR QUE localStorage como banco de dados?
  → localStorage é uma forma de guardar dados no browser do usuário.
    Os dados ficam salvos mesmo após fechar o browser (ao contrário de variáveis).
    A desvantagem é que cada usuário só vê seus próprios dados — não há
    compartilhamento entre dispositivos ou usuários diferentes.
    Para um site maior, seria necessário um banco de dados real (PostgreSQL, MongoDB, etc.)
  ════════════════════════════════════════════════════════════════
*/


// ===========================================================
// ESTADO GLOBAL DA APLICAÇÃO
// ===========================================================
/*
  "App" é o objeto central que guarda o estado atual do site.
  "Estado" = o conjunto de informações necessárias para saber
  em que situação o site está em um dado momento.

  POR QUE um único objeto em vez de variáveis separadas?
  → Organização. Em vez de currentUser, currentPostType, selectedTags
    espalhados pelo código, tudo fica em App.currentUser, App.currentPostType, etc.
    É fácil saber quais informações existem e onde encontrá-las.

  ATENÇÃO: esses dados vivem apenas na memória (RAM) do browser.
  Quando a página recarrega, o App é resetado. Por isso usamos
  sessionStorage para restaurar a sessão do usuário ao recarregar.
*/
const App = {
  currentUser:         null,   // usuário logado (objeto com id, name, email, isAdmin) ou null
  currentPostType:     null,   // tipo de post sendo criado/editado: 'novidades', 'builds' ou 'guias'
  selectedTags:        [],     // lista de tags selecionadas no modal de criação de post
  currentFilter:       { novidades: 'all', builds: 'all', guias: 'all' }, // filtro ativo em cada seção
  editingPostId:       null,   // ID do post sendo editado (null = criando novo post)
  inlineEditing:       false,  // true quando o admin está no modo de edição inline da página de detalhe
  postCardImage:       null,   // imagem de capa do post (em formato base64)
  postSections:        [],     // seções do post em edição (cada seção tem nome, conteúdo e imagens)
  _detailImages:       [],     // lista flat de imagens da página de detalhe (para o lightbox)
  myPostsTab:          'builds', // aba ativa na página "Minhas Postagens"
  currentDetailPostId: null,   // ID do post atualmente aberto na página de detalhe
  searchQuery:         '',     // termo de busca normalizado sem acentos ('' = sem busca ativa)
  _searchNav:          false,  // flag interna: fica true enquanto showPage() é acionado pela busca
  _ytEmbeddable:       null,   // resultado da verificação de embed: null=não verificado, true=ok, false=bloqueado
  _ytDebounce:         null,   // timer de debounce para não disparar a verificação a cada tecla digitada
  _pendingAvatar:      undefined, // avatar em edição no formulário de perfil: undefined=sem mudança, null=removido, string=nova imagem base64
  currentProfileId:    null,      // ID do usuário cujo perfil está aberto em #page-profile

  /*
    Estado de paginação por seção.
    Cada seção guarda:
    - page:    número da página atual (começa em 1)
    - perPage: quantos posts exibir por página (padrão 12)

    POR QUE PER-SEÇÃO E NÃO GLOBAL?
    O usuário pode querer ver 24 builds mas preferir 12 novidades.
    Guardar separado respeita a preferência de cada aba.
  */
  pagination: {
    novidades: { page: 1, perPage: 10 },
    builds:    { page: 1, perPage: 10 },
    guias:     { page: 1, perPage: 10 },
  },
};


// ===========================================================
// CREDENCIAIS DO ADMINISTRADOR
// ===========================================================
/*
  A conta de administrador é especial: não fica no localStorage,
  existe apenas aqui no código. Isso evita que alguém crie uma
  conta admin pelo cadastro normal.

  POR QUE não guardar no localStorage?
  → Qualquer pessoa poderia editar o localStorage pelo DevTools
    do browser (F12 → Application → Local Storage) e se tornar admin.
    Guardar no código é mais seguro para um site simples.
*/
/*
  SEGURANÇA (24/10/2026): a senha do admin NÃO fica mais escrita aqui.
  Guardamos só um "hash", uma impressão digital da senha feita com
  PBKDF2 (150 mil voltas + um "sal" aleatório). Dá para conferir se a
  senha digitada bate, mas não dá para descobrir a senha olhando o hash.
  Para trocar a senha do admin, gere um novo sal + hash (veja o
  comentário de hashPassword logo abaixo).
*/
const ADMIN = {
  email:     'ronancardoso22@hotmail.com',
  adminSalt: 'e9t02fLH28dmGkLxIgUx7Q==',
  adminHash: 'OGMKe+1f/OyB+IDXXXflGzLHk+LfwT+e2enVheg9oyk=',
};


// ===========================================================
// BANCO DE DADOS LOCAL (localStorage)
// ===========================================================
/*
  Funções de acesso ao "banco de dados" — o localStorage do browser.

  O localStorage guarda dados como texto (string). Como precisamos
  de listas e objetos, usamos JSON:
  - JSON.stringify: converte objeto JavaScript → texto JSON
    ex: [{id:'1', title:'Post A'}] → '[{"id":"1","title":"Post A"}]'
  - JSON.parse: converte texto JSON → objeto JavaScript (operação inversa)

  POR QUE funções separadas para get e save?
  → Se precisarmos mudar onde ou como os dados são guardados
    (ex: migrar para uma API), mudamos apenas essas funções.
    O resto do código não precisa saber os detalhes de armazenamento.

  CHAVES DO LOCALSTORAGE USADAS:
  - 'drk_users': lista de usuários cadastrados
  - 'drk_posts': lista de todos os posts (novidades, builds, guias)
*/
/*
  SEGURANÇA (24/10/2026): todo dado lido do localStorage passa por uma
  "limpeza" antes de ser usado.
  POR QUÊ? O localStorage pode ser editado por qualquer um (F12) e
  também recebe posts do agente, que vêm da Steam. Se um título ou
  link de imagem trouxer código escondido (ex.: "><script>...), e esse
  texto for colocado na página, o navegador executaria o código. Isso
  se chama XSS. Limpar na LEITURA protege todos os lugares que mostram
  esses dados de uma vez, até os que esquecem de usar escapeHtml.
*/
// Formato aceito para ids (posts, usuários, seções): letras, números, _ e -
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isSafeId = v => typeof v === 'string' && SAFE_ID.test(v);

// Texto "simples": tira os caracteres que servem para montar código HTML
const plainText = (v, max = 500) => String(v ?? '').replace(/[<>"'`]/g, '').slice(0, max);
// Texto "longo" (títulos, resumos, conteúdo): mantém aspas (escapeHtml cuida delas), tira < > e crase
const longText = (v, max = 20000) => String(v ?? '').replace(/[<>`]/g, '').slice(0, max);

/*
  Só aceita imagens de 3 origens:
  1. Enviadas pelo próprio usuário (data:image/png|jpeg|gif|webp;base64,...)
  2. Arquivos do site, na pasta imagens/ (sem ".." para não sair da pasta)
  3. CDN oficial da Steam, usada pelos posts que o agente importa
  Qualquer outra coisa (javascript:, sites desconhecidos...) vira null.
*/
const STEAM_IMG_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|steamusercontent\.com|akamaihd\.net)\//i;
function safeImageUrl(u) {
  if (typeof u !== 'string') return null;
  if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(u)) return u;
  if (/^imagens\/[^?#]*\.(png|jpe?g|webp|gif)$/i.test(u) && !u.includes('..') && !/["'<>`\s\\]/.test(u.replace(/ /g, ''))) return u;
  if (STEAM_IMG_HOSTS.test(u) && !/["'<>`\s\\]/.test(u)) return u;
  return null;
}

function sanitizeSection(s) {
  if (!s || typeof s !== 'object') return null;
  const sec = {
    ...s,
    id: isSafeId(s.id) ? s.id : 'sec-' + Math.random().toString(36).slice(2, 10),
    name: longText(s.name, 120),
    content: longText(s.content),
    images: (Array.isArray(s.images) ? s.images : []).map(safeImageUrl).filter(Boolean),
  };
  if (Array.isArray(s.rows))  sec.rows  = s.rows.map(r => ({ k: longText(r?.k, 200), v: longText(r?.v, 500) }));
  if (Array.isArray(s.items)) sec.items = s.items.map(t => longText(t, 500));
  // Bloco "Itens" do assistente: imagem + nome de troféus, artefatos e orbes
  if (s.itens && typeof s.itens === 'object') {
    const itens = {};
    ['trofeus', 'artefatos', 'orbes'].forEach(g => {
      itens[g] = (Array.isArray(s.itens[g]) ? s.itens[g] : []).slice(0, 10)
        .map(x => ({ img: safeImageUrl(x?.img), nome: longText(x?.nome, 80) }));
    });
    sec.itens = itens;
  }
  return sec;
}

function sanitizePost(p) {
  if (!p || typeof p !== 'object') return null;
  if (!isSafeId(p.id) || !isSafeId(p.authorId)) return null;
  if (!['builds', 'guias', 'novidades'].includes(p.type)) return null;
  return {
    ...p,
    title:  longText(p.title, 200),
    desc:   longText(p.desc, 1000),
    author: plainText(p.author, 60),
    date:   plainText(p.date, 60),
    emoji:  plainText(p.emoji, 16),
    tags:   (Array.isArray(p.tags) ? p.tags : []).filter(t => TAG_OPTIONS[p.type].includes(t)),
    cardImage:  safeImageUrl(p.cardImage),
    youtubeUrl: p.youtubeUrl && extractYouTubeId(String(p.youtubeUrl)) ? String(p.youtubeUrl).replace(/[<>"'`\s]/g, '') : null,
    sections:   (Array.isArray(p.sections) ? p.sections : []).map(sanitizeSection).filter(Boolean),
    images:     (Array.isArray(p.images) ? p.images : []).map(safeImageUrl).filter(Boolean),
  };
}

function sanitizeUser(u) {
  if (!u || typeof u !== 'object' || !isSafeId(u.id)) return null;
  return {
    ...u,
    name:   plainText(u.name, 60),
    bio:    u.bio == null ? u.bio : plainText(u.bio, 500),
    avatar: safeImageUrl(u.avatar),
    following: (Array.isArray(u.following) ? u.following : []).filter(isSafeId),
  };
}

// Lê JSON do localStorage sem travar o site se o dado estiver corrompido
function readJsonList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}

function getUsers()        { return readJsonList('drk_users').map(sanitizeUser).filter(Boolean); }
function saveUsers(users)  { localStorage.setItem('drk_users',  JSON.stringify(users)); }
function getPosts()        { return readJsonList('drk_posts').map(sanitizePost).filter(Boolean); }
function savePosts(posts)  { localStorage.setItem('drk_posts',  JSON.stringify(posts)); }
function getPostsByType(t) { return getPosts().filter(p => p.type === t); }

// Notificações: cada usuário tem sua própria lista em 'drk_notif_ID'
// (também limpas na leitura: o id do post vai parar dentro de um onclick)
function getNotifications(userId) {
  if (!isSafeId(userId)) return [];
  return readJsonList(`drk_notif_${userId}`).map(n => (n && typeof n === 'object') ? {
    ...n,
    postId:       isSafeId(n.postId) ? n.postId : null,
    fromUserId:   isSafeId(n.fromUserId) ? n.fromUserId : null,
    fromUserName: plainText(n.fromUserName, 60),
    postTitle:    longText(n.postTitle, 200),
    typeLabel:    ['Build', 'Guia', 'Post'].includes(n.typeLabel) ? n.typeLabel : 'Post',
    title:        n.title == null ? n.title : longText(n.title, 200),
  } : null).filter(Boolean);
}

/*
  SENHAS COM HASH (24/10/2026)
  Antes, as senhas ficavam em texto puro no navegador. Agora guardamos
  só o hash PBKDF2-SHA256 (150 mil voltas) + um sal aleatório por
  usuário. O sal faz duas pessoas com a mesma senha terem hashes
  diferentes, e as 150 mil voltas deixam lento tentar adivinhar.
  Usa o crypto.subtle, que já vem no navegador.

  Para gerar o hash de uma NOVA senha de admin, no terminal:
    node -e "const c=require('crypto'),s=c.randomBytes(16);console.log(s.toString('base64'),c.pbkdf2Sync(process.argv[1],s,150000,32,'sha256').toString('base64'))" "NOVA_SENHA"
  e cole os dois valores em adminSalt e adminHash.
*/
const PBKDF2_ITER = 150000;
const toB64   = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

async function hashPassword(password, saltB64) {
  if (!window.crypto?.subtle) throw new Error('Navegador sem suporte a criptografia (abra pelo http://localhost:8000).');
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return { hash: toB64(bits), salt: toB64(salt) };
}

// Compara dois textos sem parar no primeiro caractere diferente
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function checkPassword(password, saltB64, hashB64) {
  if (!saltB64 || !hashB64) return false;
  const { hash } = await hashPassword(password, saltB64);
  return sameText(hash, hashB64);
}
function saveNotifications(userId, notifs) { localStorage.setItem(`drk_notif_${userId}`, JSON.stringify(notifs)); }

// Adiciona uma notificação na lista do destinatário (mantém até 50)
function pushNotification(targetUserId, notif) {
  const list = getNotifications(targetUserId);
  list.unshift({ ...notif, id: 'n-' + Date.now() + '-' + Math.random().toString(36).slice(2), read: false });
  saveNotifications(targetUserId, list.slice(0, 50));
}

// Retorna os IDs dos usuários que seguem o userId informado
function getFollowers(userId) {
  return getUsers().filter(u => (u.following || []).includes(userId)).map(u => u.id);
}


// ===========================================================
// NORMALIZAÇÃO DE TEXTO (para busca sem acentos)
// ===========================================================
/*
  Remove acentos e converte para minúsculas para que a busca
  seja insensível tanto a maiúsculas quanto a acentuação.

  Exemplos:
    normalize('Fúria do Dragão') → 'furia do dragao'
    normalize('MASMORRA')        → 'masmorra'
    normalize('Guia Básico')     → 'guia basico'

  COMO FUNCIONA?
  Passo 1 — .normalize('NFD'):
    Decompõe cada letra acentuada em dois caracteres separados:
    a letra-base + o acento como caractere independente.
    'ú' (1 caractere) → 'u' + acento agudo (caractere extra invisível)
    'ã' (1 caractere) → 'a' + til (caractere extra invisível)

  Passo 2 — .replace(/[̀-ͯ]/g, ''):
    Remove todos os caracteres que sejam acentos combinantes.
    O intervalo U+0300–U+036F cobre todos os acentos do Unicode
    (agudo, grave, til, cedilha, circunflexo, trema, etc.).
    O 'g' na regex significa "aplicar em TODAS as ocorrências".

  Passo 3 — .toLowerCase():
    Converte tudo para minúsculas: 'DRAGAO' → 'dragao'.

  POR QUE ISSO EM VEZ DE SIMPLESMENTE .toLowerCase()?
  'ú'.toLowerCase() ainda é 'ú' — não vira 'u'.
  Para que "furia" encontre "Fúria", precisamos remover o acento
  de ambos os lados ANTES de comparar. normalize() faz isso.
*/
function normalize(str) {
  // ̀-ͯ = intervalo Unicode de todos os acentos combinantes
  // (agudo, grave, til, circunflexo, cedilha, trema, etc.)
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}


// ===========================================================
// PAGINAÇÃO — helpers de cálculo e renderização
// ===========================================================
/*
  getPageRange(atual, total) — gera a lista de botões a exibir.
  Com muitas páginas, não faz sentido mostrar todas — exibimos
  a primeira, a última e as páginas vizinhas da atual, com "…" nos
  saltos. Isso é chamado de paginação "com elipse".

  Exemplos:
    getPageRange(1, 4)  → [1, 2, 3, 4]             (≤7 páginas: mostra todas)
    getPageRange(1, 10) → [1, 2, 3, 4, 5, '...', 10]
    getPageRange(5, 10) → [1, '...', 4, 5, 6, '...', 10]
    getPageRange(9, 10) → [1, '...', 6, 7, 8, 9, 10]

  O array retornado é percorrido para criar os botões no HTML.
  '...' vira o caractere "…" visual (não é clicável).
*/
function getPageRange(current, total) {
  // Com 7 ou menos páginas, mostra todas sem elipse
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  // Perto do início: mostra 5 páginas seguidas, elipse, última
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];

  // Perto do final: primeira, elipse, 5 páginas seguidas do final
  if (current >= total - 3) return [1, '...', total-4, total-3, total-2, total-1, total];

  // No meio: primeira, elipse, vizinhos da atual, elipse, última
  return [1, '...', current - 1, current, current + 1, '...', total];
}

/*
  renderPagination(type, total, pages, pag) — gera o HTML da barra
  de paginação e injeta no div correspondente (ex: #novidadesPagination).

  ESTRUTURA VISUAL:
  ┌─────────────────────────────────────────────────────────────┐
  │  Exibindo 13–24 de 47 posts   [‹ Ant] [1] [2] [3] [Próx ›]   Por página: [12] [24] [36]  │
  └─────────────────────────────────────────────────────────────┘

  POR QUE NÃO RENDERIZAR DENTRO DE renderPage()?
  renderPagination() é separada para clareza: renderPage() decide QUAIS
  posts mostrar; renderPagination() decide como NAVEGAR entre eles.
  Separar responsabilidades facilita manutenção futura.
*/
function renderPagination(type, total, pages, pag) {
  const el = document.getElementById(type + 'Pagination');
  if (!el) return;

  // Atualiza o seletor de quantidade que fica fixo na barra de filtros/tags.
  // Fica sempre visível enquanto houver posts — mesmo que caibam em 1 página,
  // o usuário pode querer reduzir a quantidade após ter aumentado.
  const perPageEl = document.getElementById(type + 'PerPage');
  if (perPageEl) {
    perPageEl.innerHTML = total === 0 ? '' : `
      <span>Por página:</span>
      ${[10, 20, 40].map(n =>
        `<button class="perpage-btn ${pag.perPage === n ? 'active' : ''}"
                 onclick="setPerPage('${type}', ${n})">${n}</button>`
      ).join('')}`;
  }

  // Barra de paginação inferior: só aparece quando há múltiplas páginas.
  // Exibe apenas a informação de resultado e os botões de navegação.
  if (total === 0) { el.innerHTML = ''; return; }

  if (pages <= 1) { el.innerHTML = ''; return; }

  const start = (pag.page - 1) * pag.perPage + 1;
  const end   = Math.min(pag.page * pag.perPage, total);

  const range = getPageRange(pag.page, pages);
  const pageBtns = range.map(item =>
    item === '...'
      ? `<span class="page-ellipsis">…</span>`
      : `<button class="page-btn ${item === pag.page ? 'active' : ''}"
                 onclick="goToPage('${type}', ${item})">${item}</button>`
  ).join('');

  el.innerHTML = `
    <span class="pagination-info">
      Exibindo ${start}–${end} de ${total} post${total !== 1 ? 's' : ''}
    </span>
    <div class="pagination-controls">
      <button class="page-btn" onclick="goToPage('${type}', ${pag.page - 1})"
              ${pag.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      ${pageBtns}
      <button class="page-btn" onclick="goToPage('${type}', ${pag.page + 1})"
              ${pag.page >= pages ? 'disabled' : ''}>Próxima ›</button>
    </div>
  `;
}

/*
  goToPage(type, n) — navega para uma página específica.
  Após trocar de página, rola a tela para o topo do conteúdo
  (logo abaixo da navbar de 64px) para que o usuário veja os
  novos cards sem precisar rolar manualmente.
*/
function goToPage(type, n) {
  const pag   = App.pagination[type];
  const total = (() => {
    // Recalcula o total de posts visíveis com os filtros atuais
    let posts = getPostsByType(type);
    const uid = App.currentUser?.id;
    if (!App.currentUser?.isAdmin) posts = posts.filter(p => !p.suspended || p.authorId === uid);
    const f = App.currentFilter[type];
    if (f && f !== 'all') posts = posts.filter(p => p.tags.includes(f));
    if (App.searchQuery) {
      const q = App.searchQuery;
      posts = posts.filter(p =>
        normalize(p.title).includes(q) ||
        normalize(p.desc).includes(q)  ||
        p.tags.some(t => normalize(t).includes(q))
      );
    }
    return posts.length;
  })();
  const pages = Math.ceil(total / pag.perPage);

  // Garante que o número de página seja válido
  pag.page = Math.max(1, Math.min(n, pages));
  renderPage(type);

  // Rola suavemente para o topo da grade de posts (abaixo da navbar)
  const grid = document.getElementById({ novidades:'novidadesGrid', builds:'buildsGrid', guias:'guiasGrid' }[type]);
  if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/*
  setPerPage(type, n) — muda quantos posts são exibidos por página.
  Volta sempre para a primeira página para evitar que o usuário
  fique numa página que não existe mais (ex: estava na página 5 com
  12 posts/pág → muda para 36/pág → página 5 não existe mais).
*/
function setPerPage(type, n) {
  App.pagination[type].perPage = n;
  App.pagination[type].page    = 1;
  renderPage(type);
}


// ===========================================================
// POSTS PADRÃO (conteúdo inicial do site)
// ===========================================================
/*
  Quando o site é aberto pela primeira vez (localStorage vazio),
  esta função popula o banco com posts de exemplo.

  POR QUE posts de exemplo?
  → Evita que o site apareça completamente vazio para novos visitantes.
    Dá uma ideia do tipo de conteúdo que o site terá.

  POR QUE verificar getPosts().length > 0 antes de criar?
  → Se o site já tem posts (usuário voltando), não queremos
    recriar os posts de exemplo e sobrescrever o conteúdo real.
    A verificação protege contra isso.

  Date.now() e DAY:
  → Date.now() retorna o timestamp atual em milissegundos (ms).
    DAY = 86400000ms = 24h × 60min × 60s × 1000ms.
    Subtrair DAY × N de Date.now() gera timestamps de N dias atrás,
    fazendo os posts parecerem publicados em datas diferentes.
*/
function seedDefaultPosts() {
  if (getPosts().length > 0) return; // já tem posts, não recria

  const now = Date.now();
  const DAY = 86400000; // milissegundos em 1 dia

  savePosts([
    // ── NOVIDADES ──
    {
      id: 'seed-1', type: 'novidades',
      title: 'Patch 1.2.0 – A Era das Sombras',
      desc: 'Novos itens, masmorras e ajustes de balanceamento chegam ao Drakbuilder. Prepare-se para a batalha definitiva.',
      emoji: '🏰', tags: ['ATUALIZAÇÃO'],
      author: 'Equipe Drakbuilder', authorId: 'system',
      date: '22 de Junho, 2024', timestamp: now - DAY * 3,
      sections: [], images: [], youtubeUrl: null,
    },
    {
      id: 'seed-2', type: 'novidades',
      title: 'Evento: Investida dos Dracônios',
      desc: 'Participe do evento por tempo limitado e ganhe recompensas exclusivas. Colete fragmentos de dragão e forje artefatos lendários.',
      emoji: '🔥', tags: ['EVENTO'],
      author: 'Equipe Drakbuilder', authorId: 'system',
      date: '18 de Junho, 2024', timestamp: now - DAY * 7,
      sections: [], images: [], youtubeUrl: null,
    },
    {
      id: 'seed-3', type: 'novidades',
      title: 'Nova Região: Terras Ancestrais',
      desc: 'Explore as Terras Ancestrais e descubra segredos esquecidos. Uma nova história aguarda os aventureiros mais corajosos.',
      emoji: '🗺️', tags: ['NOTÍCIAS'],
      author: 'Equipe Drakbuilder', authorId: 'system',
      date: '15 de Junho, 2024', timestamp: now - DAY * 10,
      sections: [], images: [], youtubeUrl: null,
    },
    // ── BUILDS ──
    {
      id: 'seed-4', type: 'builds',
      title: 'Guerreiro – Fúria do Dragão',
      desc: 'Build focada em Dano Sustentado com ótima sobrevivência para conteúdo de Endgame. Ideal para masmorras longas e chefes de raid.',
      emoji: '⚔️', tags: ['PVE', 'ENDGAME'],
      author: 'DragonMaster', authorId: 'system',
      date: '20 de Junho, 2024', timestamp: now - DAY * 5,
      sections: [
        { id: 'sec-s4-1', name: 'Visão Geral',   content: 'Esta build maximiza o dano sustentado utilizando a combinação de Fúria do Dragão e Escama de Ferro. Ideal para tankar chefes em raids longas com mínima rotação de cura.' },
        { id: 'sec-s4-2', name: 'Atributos',     content: 'Força: 50\nVitalidade: 30\nDestreza: 10\n\nPriorize Força até atingir o cap de dano, depois invista em Vitalidade para sobrevivência prolongada.' },
        { id: 'sec-s4-3', name: 'Equipamentos',  content: 'Cabeça: Elmo do Dragão Ancião\nPeito: Armadura de Escamas Negras\nArma: Espada dos Condenados\nEscudo: Escudo de Magma\nAcessório: Anel de Fogo Eterno' },
      ],
      images: [], youtubeUrl: null,
    },
    {
      id: 'seed-5', type: 'builds',
      title: 'Arqueiro – Flecha Sombria',
      desc: 'Especializada em Dano em Área e farm de recursos. Limpa grupos de inimigos com velocidade impressionante.',
      emoji: '🏹', tags: ['PVE', 'FARM'],
      author: 'ShadowArcher', authorId: 'system',
      date: '17 de Junho, 2024', timestamp: now - DAY * 8,
      sections: [
        { id: 'sec-s5-1', name: 'Visão Geral',  content: 'Arqueiro de área para farm eficiente de recursos. Combine Chuva de Flechas com Veneno da Sombra para dano massivo em grupos grandes.' },
        { id: 'sec-s5-2', name: 'Habilidades',  content: '1. Chuva de Flechas (AoE principal)\n2. Veneno da Sombra (DoT)\n3. Passo Veloz (mobilidade)\n4. Olho de Falcão (aumento de crítico)' },
      ],
      images: [], youtubeUrl: null,
    },
    {
      id: 'seed-6', type: 'builds',
      title: 'Mago – Tempestade Arcana',
      desc: 'Explosão Mágica devastadora tanto no PVE quanto no PVP. Domine o campo de batalha com feitiços de área.',
      emoji: '🔮', tags: ['PVE', 'PVP'],
      author: 'ArcaneWizard', authorId: 'system',
      date: '14 de Junho, 2024', timestamp: now - DAY * 11,
      sections: [
        { id: 'sec-s6-1', name: 'Visão Geral',  content: 'Build de burst mágico para PVP e PVE de alta dificuldade. Alta magia a custo de mobilidade reduzida. Requer posicionamento preciso e bom timing de cooldowns.' },
        { id: 'sec-s6-2', name: 'Rotação PVP',  content: '1. Escudo Arcano (proteção)\n2. Raio de Gelo (slow)\n3. Tempestade Arcana (burst principal)\n4. Portal de Fuga (escape se necessário)' },
      ],
      images: [], youtubeUrl: null,
    },
    // ── GUIAS ──
    {
      id: 'seed-7', type: 'guias',
      title: 'Guia para Iniciantes',
      desc: 'Dicas essenciais para começar bem sua jornada no Drakbuilder. Do tutorial à sua primeira masmorra, aprenda tudo aqui.',
      emoji: '📖', tags: ['INICIANTE'],
      author: 'Sábio Ancião', authorId: 'system',
      date: '10 de Junho, 2024', timestamp: now - DAY * 15,
      sections: [
        { id: 'sec-s7-1', name: 'Primeiros Passos',        content: 'Bem-vindo ao Drakbuilder! Ao criar seu personagem, escolha sua classe com cuidado — ela definirá seu estilo de jogo por toda a aventura.\n\nClasses disponíveis: Guerreiro, Arqueiro, Mago e Paladino. Cada uma tem pontos fortes e fracos únicos.' },
        { id: 'sec-s7-2', name: 'Sistema de Progressão',   content: 'Você ganha EXP completando quests e derrotando inimigos. A cada 10 níveis, você recebe um ponto de habilidade especial para gastar em talentos únicos da sua classe.' },
        { id: 'sec-s7-3', name: 'Primeiras Masmorras',     content: 'As masmorras de iniciante ficam na Floresta das Sombras, ao norte da cidade inicial. Nível recomendado: 10–15 para a primeira masmorra, 20–25 para a segunda.' },
      ],
      images: [], youtubeUrl: null,
    },
    {
      id: 'seed-8', type: 'guias',
      title: 'Como Farmar Ouro Eficientemente',
      desc: 'Melhores métodos para acumular ouro rapidamente. Guia completo de rotas, horários e estratégias de economia.',
      emoji: '💰', tags: ['ECONOMIA'],
      author: 'GoldFarmer', authorId: 'system',
      date: '8 de Junho, 2024', timestamp: now - DAY * 17,
      sections: [
        { id: 'sec-s8-1', name: 'Melhores Rotas',   content: 'Rota 1: Mercado Central → Minas do Norte → Floresta do Leste (ciclo de 30 min)\nRota 2: Masmorra do Ouro → Vendedor → repetir (nível 30+)\n\nDica: complete Rota 1 duas vezes antes de tentar Rota 2.' },
        { id: 'sec-s8-2', name: 'Itens Valiosos',   content: 'Venda sempre: Gemas Brutas, Ossos de Dragão, Ervas Raras.\nNunca venda: Fragmentos de Runas (use para encantamento de equipamentos).\nGuarde: Pedras de Portal (valor dobra nos finais de semana).' },
      ],
      images: [], youtubeUrl: null,
    },
    {
      id: 'seed-9', type: 'guias',
      title: 'Masmorras e Raides',
      desc: 'Estratégias para enfrentar os maiores desafios do jogo. Formação de grupo, mecânicas de chefe e dicas avançadas.',
      emoji: '🏛️', tags: ['DUNGEON', 'AVANÇADO'],
      author: 'RaidLeader', authorId: 'system',
      date: '5 de Junho, 2024', timestamp: now - DAY * 20,
      sections: [
        { id: 'sec-s9-1', name: 'Formação de Grupo',          content: '1 Tank + 2 Healers + 3-5 DPS é a formação padrão para raids de 6 a 8 jogadores.\nPara masmorras de 4 pessoas: 1 Tank + 1 Healer + 2 DPS.' },
        { id: 'sec-s9-2', name: 'Mecânicas do Chefe Final',   content: 'Fase 1 (100–60% HP): Ataques normais + Rugido de Fogo (AoE — saia do círculo vermelho)\nFase 2 (60–30% HP): Adiciona invocados; foque nos adds primeiro\nFase 3 (30–0% HP): Enrage — maximize DPS e use todos os cooldowns' },
        { id: 'sec-s9-3', name: 'Recompensas',                content: 'Primeira conclusão: Equipamento Épico (3 peças)\nConclusões semanais: 500 Ouro + Fragmento de Runas\nRanking do servidor: Títulos exclusivos e montaria especial' },
      ],
      images: [], youtubeUrl: null,
    },
  ]);
}


// ===========================================================
// CAPAS DOS POSTS DE EXEMPLO (prints oficiais da Steam)
// ===========================================================
/*
  Os posts de exemplo nasceram sem imagem de capa. Esta função dá a
  cada um deles um print real do jogo, guardado em imagens/steam/.

  POR QUE uma "migração" em vez de só editar os posts de exemplo acima?
  → Os posts de exemplo só são criados quando o navegador está vazio.
    Quem já abriu o site tem eles salvos no localStorage, sem capa.
    Esta função roda em toda carga e completa o que estiver faltando.

  POR QUE ela é segura?
  → Só mexe em posts cujo id está na lista abaixo (os de exemplo).
    Posts criados por usuários têm outros ids e nunca são tocados.
  → Se o post já tem capa (alguém escolheu uma), ela é mantida.

  A escolha de cada print tenta combinar com o título do post
  (ex.: dragão de gelo para a build "Fúria do Dragão").
*/
const SEED_COVERS = {
  // ── Builds ──
  'seed-4': 'imagens/steam/ss07.jpg',          // Guerreiro – Fúria do Dragão → luta contra dragão
  'seed-5': 'imagens/steam/ss01.jpg',          // Arqueiro – Flecha Sombria → floresta sombria
  'seed-6': 'imagens/steam/ss15.jpg',          // Mago – Tempestade Arcana → plataforma arcana
  // ── Guias ──
  'seed-7': 'imagens/steam/ss04.jpg',          // Guia para Iniciantes → cidade
  'seed-8': 'imagens/steam/ss09.jpg',          // Farmar Ouro → combate na selva
  'seed-9': 'imagens/steam/ss08.jpg',          // Masmorras e Raides → salão de chefe
  'tg-01':  'imagens/steam/ss02.jpg',          // Primeiros Passos → portão do castelo
  'tg-02':  'imagens/steam/library_hero.jpg',  // Sistema de Classes → fila de heróis
  'tg-03':  'imagens/steam/ss06.jpg',          // Profissões → santuário
  'tg-04':  'imagens/steam/ss11.jpg',          // Atributos → salão dourado
  'tg-05':  'imagens/steam/ss14.jpg',          // Gold Rápido → campo aberto
  'tg-06':  'imagens/steam/ss10.jpg',          // Mercado/Trading → salão de relíquias
  'tg-07':  'imagens/steam/ss13.jpg',          // Missões Diárias → árvore ancestral
  'tg-08':  'imagens/steam/ss05.jpg',          // Drop de Itens Raros → sala do trono com cristais
  'tg-09':  'imagens/steam/ss12.jpg',          // Caverna do Goblin → sala escura de ritual
  'tg-10':  'imagens/steam/ss01.jpg',          // Crypta das Sombras → floresta sombria
  'tg-11':  'imagens/steam/ss15.jpg',          // Torre do Mago Sombrio → plataforma arcana
  'tg-12':  'imagens/steam/ss03.jpg',          // Fortaleza dos Mortos-Vivos → templo à noite
  'tg-13':  'imagens/steam/ss08.jpg',          // Encantamentos e Runas → círculo rúnico
  'tg-14':  'imagens/steam/ss07.jpg',          // PVP Avançado → combate
  'tg-15':  'imagens/steam/ss02.jpg',          // Guildas → castelo
};

function applySeedCovers() {
  const posts = getPosts();
  let mudou = false; // só salvamos se algo realmente mudou

  posts.forEach(p => {
    const capa = SEED_COVERS[p.id];
    if (capa && !p.cardImage) { // é post de exemplo e ainda está sem capa
      p.cardImage = capa;
      mudou = true;
    }
  });

  if (mudou) savePosts(posts);
}


// ===========================================================
// DADOS DE TESTE — 15 guias para visualização da paginação
// ===========================================================
/*
  seedTestGuias() insere 15 guias variados no localStorage para
  que a paginação e os filtros possam ser testados com dados reais.

  POR QUE UMA CHAVE SEPARADA ('drk_test_guias_seeded')?
  → Ao usar um marcador separado, podemos verificar se os dados já foram
    inseridos sem depender do número total de posts (que pode mudar).
    Se o usuário criar posts e depois recarregar, os dados de teste
    não são inseridos de novo.

  COMO REMOVER OS DADOS DE TESTE?
  → Abra o Console do navegador (F12 → Console) e execute:
    localStorage.removeItem('drk_test_guias_seeded');
    location.reload();
  Isso remove o marcador e recria os posts padrão na próxima carga.
  Para limpar tudo: localStorage.clear(); location.reload();
*/
function seedTestGuias() {
  // Verifica se os dados de teste já foram inseridos para não duplicar
  if (localStorage.getItem('drk_test_guias_seeded')) return;

  const now = Date.now();
  const H   = 3600000;   // milissegundos em 1 hora
  const DAY = 86400000;  // milissegundos em 1 dia

  const testGuias = [
    // ── INICIANTE ─────────────────────────────────────────────────────────
    {
      id: 'tg-01', type: 'guias',
      title: 'Primeiros Passos no Drakantos',
      desc: 'Tudo que um novo aventureiro precisa saber antes de começar sua jornada: criação de personagem, primeiras missões e dicas essenciais.',
      emoji: '🌟', tags: ['INICIANTE'],
      sections: [
        { name: 'Criando seu Personagem', content: 'Ao entrar no jogo pela primeira vez, você terá quatro classes disponíveis: Guerreiro, Arqueiro, Mago e Clérigo. Cada uma tem um estilo de jogo muito diferente. O Guerreiro é ideal para iniciantes por ser resistente ao dano.', images: [] },
        { name: 'Suas Primeiras Missões', content: 'Fale com o NPC Mestre Aldrin na Cidade de Elaris para receber as missões de tutorial. Elas ensinam os controles básicos e recompensam com equipamentos suficientes para os primeiros dungeons.', images: [] },
        { name: 'Dicas de Sobrevivência', content: 'Nunca saia de Elaris sem pelo menos 10 poções de vida. Verifique sempre o nível recomendado de cada área antes de entrar. Morra perto de um obelisco para ressuscitar sem penalidade.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 45).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 45,
    },
    {
      id: 'tg-02', type: 'guias',
      title: 'Sistema de Classes: Qual Escolher?',
      desc: 'Comparação detalhada entre as quatro classes do jogo, com prós e contras de cada uma para diferentes estilos de jogo.',
      emoji: '⚔️', tags: ['INICIANTE'],
      sections: [
        { name: 'Guerreiro', content: 'Alta defesa e vida. Excelente em dungeons como tanque. Dano moderado. Recomendado para quem gosta de estar no centro da batalha e proteger a equipe.', images: [] },
        { name: 'Mago', content: 'Dano muito alto a distância, mas baixa defesa. Requer posicionamento cuidadoso. Devastador em PVE, mas difícil no PVP sem prática. A classe mais recompensadora quando dominada.', images: [] },
        { name: 'Arqueiro e Clérigo', content: 'O Arqueiro equilibra dano e mobilidade, perfeito para PVP. O Clérigo é o suporte por excelência — indispensável em dungeons de alto nível mas dependente de uma equipe para ser eficaz.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 40).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 40,
    },
    {
      id: 'tg-03', type: 'guias',
      title: 'Guia de Profissões para Iniciantes',
      desc: 'Como escolher, desenvolver e lucrar com as profissões de artesanato do jogo. Ferreiro, Alquimista e Alfaiate explicados do zero.',
      emoji: '🔨', tags: ['INICIANTE'],
      sections: [
        { name: 'Por que investir em profissões?', content: 'Profissões permitem criar equipamentos e consumíveis que você usaria diariamente. Itens craftados de nível máximo frequentemente superam drops de dungeons comuns.', images: [] },
        { name: 'Ferreiro vs Alquimista', content: 'O Ferreiro cria armas e armaduras — ótimo no longo prazo mas exige muito material. O Alquimista fabrica poções e elixires — retorno de ouro mais rápido mas margem menor por item.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 38).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 38,
    },
    {
      id: 'tg-04', type: 'guias',
      title: 'Sistema de Atributos Explicado',
      desc: 'Força, Agilidade, Inteligência, Resistência — entenda o que cada atributo faz e como distribuir seus pontos de forma eficiente.',
      emoji: '📊', tags: ['INICIANTE'],
      sections: [
        { name: 'Os 4 Atributos Principais', content: 'Força aumenta o dano físico e a capacidade de carga. Agilidade melhora velocidade de ataque e esquiva. Inteligência eleva o dano mágico e o mana máximo. Resistência aumenta a vida máxima e a defesa.', images: [] },
        { name: 'Distribuição Recomendada', content: 'Guerreiros devem focar em Força e Resistência (60/40). Magos em Inteligência pura. Arqueiros em Agilidade e Força. Clérigos em Inteligência e Resistência para sobreviver no campo de batalha.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 35).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 35,
    },

    // ── ECONOMIA ─────────────────────────────────────────────────────────
    {
      id: 'tg-05', type: 'guias',
      title: 'Como Ganhar Gold Rápido no Drakantos',
      desc: 'Os melhores métodos para acumular ouro no início do jogo, do farm de monstros ao mercado de jogadores.',
      emoji: '💰', tags: ['ECONOMIA'],
      sections: [
        { name: 'Farm de Monstros', content: 'A Floresta de Yeldrin entre os níveis 15–25 tem a melhor taxa de drop de gold por hora para iniciantes. Monstros do tipo Goblin Saqueador dropam bolsas de ouro com frequência acima da média.', images: [] },
        { name: 'Vendendo no Mercado', content: 'Materiais de craft como Minério de Ferro e Ervas Medicinais têm demanda constante. Verifique o preço médio antes de vender para não receber menos do que o item vale.', images: [] },
        { name: 'Missões Diárias', content: 'Completar as 5 missões diárias da Guilda garante entre 500 e 1.200 gold por dia dependendo do nível. É a fonte mais estável de renda para jogadores casuais.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 32).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 32,
    },
    {
      id: 'tg-06', type: 'guias',
      title: 'Mercado de Jogadores: Guia de Trading',
      desc: 'Aprenda a comprar barato e vender caro no mercado do jogo. Estratégias de flip de itens e como identificar oportunidades.',
      emoji: '📈', tags: ['ECONOMIA'],
      sections: [
        { name: 'O que é Flipping?', content: 'Flipping é comprar itens abaixo do preço de mercado e revender com lucro. Para funcionar, você precisa conhecer o preço médio de cada item — consulte o histórico de preços antes de comprar.', images: [] },
        { name: 'Itens com Maior Margem', content: 'Poções de Stamina, Runas de Encantamento e Receitas de Craft raras costumam ter as maiores variações de preço. Comprados nos fins de semana (mais oferta) e vendidos na segunda (mais demanda).', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 28).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 28,
    },
    {
      id: 'tg-07', type: 'guias',
      title: 'Rotina de Missões Diárias Lucrativa',
      desc: 'Otimize seu tempo de jogo com uma rotina de missões diárias que maximiza gold, experiência e reputação ao mesmo tempo.',
      emoji: '📅', tags: ['ECONOMIA'],
      sections: [
        { name: 'A Rota Otimizada', content: 'Comece pelas missões da Guilda em Elaris (15 min), depois as da Cidade dos Anões em Khorrum (20 min), e finalize com as da Floresta Élfica (25 min). Total: 60 minutos para a recompensa máxima diária.', images: [] },
        { name: 'Reputação Bônus', content: 'Missões repetidas na mesma facção aumentam sua Reputação. Com Reputação Exaltada, os preços das lojas de NPC caem 15% e itens exclusivos de alta qualidade ficam disponíveis.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 25).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 25,
    },
    {
      id: 'tg-08', type: 'guias',
      title: 'Maximizando o Drop Rate de Itens Raros',
      desc: 'Como usar Sorte, Runas e consumíveis para aumentar as chances de obter itens épicos e lendários nos dungeons.',
      emoji: '🎲', tags: ['ECONOMIA'],
      sections: [
        { name: 'O Atributo Sorte', content: 'Cada ponto de Sorte aumenta em 0,5% a chance de drop de itens raros. O cap de Sorte é 200 pontos (100% de bônus sobre a chance base). Use o Amuleto da Fortuna no slot de acessório.', images: [] },
        { name: 'Elixir de Pilhagem', content: 'O Elixir de Pilhagem dobra temporariamente o bônus de Sorte por 30 minutos. Use-o apenas nos bosses finais de dungeons, onde a chance de drop de lendários é maior.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 22).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 22,
    },

    // ── DUNGEON ─────────────────────────────────────────────────────────
    {
      id: 'tg-09', type: 'guias',
      title: 'Dungeon: Caverna do Goblin — Guia Completo',
      desc: 'Walkthrough detalhado da primeira dungeon do jogo. Mecânicas de cada boss, composição de grupo recomendada e melhores drops.',
      emoji: '🏚️', tags: ['DUNGEON'],
      sections: [
        { name: 'Requisitos e Composição', content: 'Nível mínimo recomendado: 10. Composição ideal: 1 Tanque, 1 Clérigo, 2 DPS. A dungeon tem 3 salas e 2 mini-bosses antes do boss final: Rei Goblin Gortusk.', images: [] },
        { name: 'Boss: Rei Goblin Gortusk', content: 'Gortusk alterna entre dois modos: Modo Fúria (dano alto, lento) e Modo Ágil (dano baixo, muito rápido). No Modo Fúria, o tanque segura; no Modo Ágil, todos se afastam e os DPS atacam à distância.', images: [] },
        { name: 'Drops Notáveis', content: 'Gortusk tem 15% de chance de dropar o Escudo de Gortusk (excelente para Guerreiros nível 10–20) e 5% de chance do Amuleto do Goblin (aumenta Sorte em 20 pontos).', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 20).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 20,
    },
    {
      id: 'tg-10', type: 'guias',
      title: 'Dungeon: Crypta das Sombras',
      desc: 'Uma das dungeons mais temidas do mid-game. Mecânicas de maldição, puzzles de altar e estratégia para o boss final Lich Varethon.',
      emoji: '💀', tags: ['DUNGEON'],
      sections: [
        { name: 'Mecânica de Maldição', content: 'Ao entrar em certas salas, todos os jogadores recebem a maldição Sombra Eterna que reduz a cura recebida em 50%. O Clérigo deve lançar Purificação nos aliados malditos antes de curar.', images: [] },
        { name: 'Puzzles de Altar', content: 'A dungeon tem 4 altares que precisam ser ativados na ordem correta para destravar a câmara do boss. Ordem: Vermelho → Azul → Verde → Branco. Ordem errada invoca um grupo de Espectros.', images: [] },
        { name: 'Boss: Lich Varethon', content: 'Varethon possui 3 fases. Na fase 2 (50% de HP), invoca 4 esqueletos que devem ser eliminados antes de continuar o dano no boss. Na fase 3 (20% de HP), toda a equipe recebe dano constante — use todos os consumíveis.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 18).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 18,
    },
    {
      id: 'tg-11', type: 'guias',
      title: 'Dungeon: Torre do Mago Sombrio',
      desc: 'Dungeon de 10 andares com escalada progressiva de dificuldade. Cada andar traz mecânicas únicas. Ideal para farm de runas de encantamento.',
      emoji: '🗼', tags: ['DUNGEON'],
      sections: [
        { name: 'Estrutura da Torre', content: 'Cada 3 andares há um boss intermediário. O andar 10 contém o boss final Arcaist Mordren. Você pode pausar no andar 3 ou 6 e continuar depois — o progresso é salvo por 24 horas.', images: [] },
        { name: 'Farm de Runas', content: 'Os andares 5–7 têm a maior densidade de inimigos encantados, que dropam Runas de Encantamento com frequência acima da média. Use o Elixir de Pilhagem antes do andar 5 para maximizar os drops.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 15).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 15,
    },
    {
      id: 'tg-12', type: 'guias',
      title: 'Dungeon: Fortaleza dos Mortos-Vivos',
      desc: 'A dungeon mais longa do jogo com 6 bosses sequenciais. Guia de mecânicas, rotação de habilidades e composição ideal para clear rápido.',
      emoji: '🏰', tags: ['DUNGEON'],
      sections: [
        { name: 'Composição Ideal', content: 'Para um clear rápido: 2 Tanques, 2 Clérigos, 2 Magos, 2 Arqueiros. A fortaleza tem encontros de dano em área que exigem dois tanques para dividir a ameaça entre os bosses gêmeos do andar 3.', images: [] },
        { name: 'Boss Gêmeos: Mortus e Vivus', content: 'O truque dos bosses gêmeos é que eles compartilham HP. Dano em Mortus também afeta Vivus e vice-versa. Posicione-os sobrepostos e use ataques em área para dobrar o dano efetivo.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 12).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 12,
    },

    // ── AVANÇADO ─────────────────────────────────────────────────────────
    {
      id: 'tg-13', type: 'guias',
      title: 'Sistema de Encantamentos e Runas',
      desc: 'Guia completo sobre o sistema de encantamento de equipamentos. Runas, combinações e como evitar quebrar itens valiosos.',
      emoji: '✨', tags: ['AVANÇADO'],
      sections: [
        { name: 'Como Funciona o Encantamento', content: 'Leve o item e as runas ao NPC Feiticeiro Enlor em Khorrum. Cada encantamento tem uma chance de sucesso que diminui a cada tentativa no mesmo item. Encantamento +5 em diante exige Runas de Estabilidade para evitar degradação.', images: [] },
        { name: 'Combinações de Runas', content: 'Runa de Fogo + Runa de Sangue = Encantamento Chama Sanguínea (dano ao longo do tempo). Runa de Gelo + Runa de Vento = Encantamento Vendaval Glacial (reduz velocidade do inimigo em 30%).', images: [] },
        { name: 'Evitando Perda de Itens', content: 'Sempre use o Pergaminho de Proteção em itens acima de +7 antes de tentar o próximo encantamento. Sem proteção, a falha no +8 em diante destrói o item permanentemente.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 9).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 9,
    },
    {
      id: 'tg-14', type: 'guias',
      title: 'Técnicas de PVP Avançado: Kiting e Combos',
      desc: 'Domine as técnicas de kiting, stun-lock e rotações de habilidades que separam os melhores jogadores de PVP da média.',
      emoji: '🎯', tags: ['AVANÇADO'],
      sections: [
        { name: 'O que é Kiting?', content: 'Kiting é manter distância do inimigo enquanto causa dano, evitando receber golpes. Fundamental para Arqueiros e Magos. Use habilidades de retardo (raiz, lentidão) para ganhar espaço sempre que o oponente se aproximar.', images: [] },
        { name: 'Stun-lock e Rotações', content: 'Stun-lock é encadear habilidades de controle para que o inimigo nunca consiga agir. Combo básico do Guerreiro: Golpe Giratório (atordoa 1s) → Esmagamento (1s) → Golpe Decisivo (dano pesado enquanto atordoado).', images: [] },
        { name: 'Lendo o Oponente', content: 'Observe o animation cancel — jogadores avançados interrompem animações de habilidades para reduzir o tempo entre os golpes. Aprenda as animações de cada classe para antecipar os ataques e contra-atacar no momento certo.', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 6).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 6,
    },
    {
      id: 'tg-15', type: 'guias',
      title: 'Guia de Guildas: Como Crescer e Liderar',
      desc: 'Tudo sobre o sistema de guildas do Drakantos: como criar, recrutar, gerenciar o banco da guilda e organizar eventos de guerra.',
      emoji: '🛡️', tags: ['AVANÇADO'],
      sections: [
        { name: 'Criando uma Guilda', content: 'Fale com o Escrivão Real em Elaris com 500 gold e 10 assinaturas de outros jogadores. A guilda começa no Rank G com 20 vagas. Suba de rank completando Missões de Guilda semanais para desbloquear mais vagas e benefícios.', images: [] },
        { name: 'Banco da Guilda', content: 'O banco compartilha recursos entre todos os membros. Configure as permissões por cargo: Membros só depositam; Oficiais podem retirar até 500 gold/dia; o Líder tem acesso total. Revise o log do banco semanalmente para detectar abusos.', images: [] },
        { name: 'Guerra de Guildas', content: 'Guerras acontecem toda sexta-feira às 20h. A guilda com mais pontos de captura de território ao fim de 2 horas vence. Distribua os membros em equipes de ataque (Magos + Arqueiros) e defesa (Guerreiros + Clérigos).', images: [] },
      ],
      youtubeUrl: null, cardImage: null,
      author: 'Administrador', authorId: 'admin',
      date: new Date(now - DAY * 3 + H * 4).toLocaleDateString('pt-BR', { day:'numeric', month:'long', year:'numeric' }),
      timestamp: now - DAY * 3 + H * 4,
    },
  ];

  // Insere os guias de teste junto com os posts já existentes
  const existing = getPosts();
  // Remove qualquer guia de teste anterior (pelos IDs que começam com 'tg-')
  const withoutOldTest = existing.filter(p => !p.id.startsWith('tg-'));
  savePosts([...withoutOldTest, ...testGuias]);

  // Marca que os dados de teste foram inseridos para não repetir
  localStorage.setItem('drk_test_guias_seeded', '1');
}


// ===========================================================
// MENU MOBILE (hambúrguer)
// ===========================================================
/*
  Em telas pequenas (celular), o menu de navegação fica escondido
  atrás de um botão de três linhas (☰), chamado "hambúrguer".
  Clicar nele abre/fecha o menu.

  classList.toggle('open') → adiciona a classe 'open' se não tiver,
  remove se já tiver — alterna entre aberto e fechado com uma chamada.
*/
function toggleMobileMenu() {
  document.querySelector('.nav-links').classList.toggle('open');
  document.getElementById('navHamburger').classList.toggle('open');
}

/*
  Fecha o menu mobile sem alternar — força fechamento.
  Chamada ao clicar em um link do menu ou navegar para outra página.
  POR QUE remove('open') em vez de toggle?
  → toggle poderia ABRIR o menu se ele estivesse fechado.
    remove() garante que ele sempre FECHA, independente do estado atual.
*/
function closeMobileMenu() {
  document.querySelector('.nav-links').classList.remove('open');
  document.getElementById('navHamburger').classList.remove('open');
}


// ===========================================================
// NAVEGAÇÃO ENTRE PÁGINAS (SPA — Single Page Application)
// ===========================================================
/*
  O site parece ter várias páginas, mas é um único arquivo HTML.
  Cada "página" é uma div com class="page". Só uma fica visível
  por vez (com class="active"). As outras ficam ocultas via CSS
  (display:none quando não têm a classe 'active').

  POR QUE SPA em vez de arquivos HTML separados?
  → Navegação mais rápida (não recarrega o browser).
    Os dados em memória (App.currentUser, etc.) são mantidos.
    Mais simples de implementar em um site pequeno.

  PASSO A PASSO do showPage():
  1. Remove a classe 'active' de todas as páginas (esconde todas)
  2. Adiciona 'active' apenas na página alvo (exibe só ela)
  3. Atualiza o destaque no menu de navegação
  4. Fecha o menu mobile se estiver aberto
  5. Rola a tela para o topo (experiência mais natural)
  6. Se a página tiver conteúdo dinâmico, renderiza ele
*/
function showPage(pageId) {
  /*
    Quando o usuário clica em um link de navegação (Início, Novidades, etc.),
    a busca ativa deve ser limpa — o usuário escolheu sair do contexto de busca.
    Usamos a flag App._searchNav para distinguir:
    — false (navegação manual pelo usuário) → limpa campo e resultado de busca
    — true  (navegação acionada pelo handleSearch) → mantém a busca ativa
  */
  if (!App._searchNav) {
    App.searchQuery = '';
    const si = document.getElementById('searchInput');
    if (si) si.value = ''; // limpa o campo de busca visualmente
  }

  // Esconde todas as páginas removendo a classe 'active'
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Exibe apenas a página solicitada
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');

  // Destaca o link correto no menu de navegação
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === pageId);
  });

  closeMobileMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' }); // rola suavemente para o topo

  // Carrega o conteúdo específico de cada página
  if (pageId === 'home')      renderHome();
  if (pageId === 'novidades') renderPage('novidades');
  if (pageId === 'builds')    renderPage('builds');
  if (pageId === 'guias')     renderPage('guias');
  if (pageId === 'myposts')   renderMyPosts();
  if (pageId === 'settings')  renderSettings();
  if (pageId === 'profile')   renderProfile();
}


// ===========================================================
// AUTENTICAÇÃO — MODAL DE LOGIN/CADASTRO
// ===========================================================
/*
  O modal é uma janela flutuante sobre o conteúdo principal.
  Abrir = remover a classe 'hidden'.
  Fechar = adicionar a classe 'hidden'.
  O CSS faz display:none quando tem 'hidden' e display:flex quando não tem.

  POR QUE modal em vez de página separada?
  → O usuário mantém o contexto (vê o conteúdo atrás do modal).
    Depois do login, volta exatamente para onde estava.
*/
function openAuthModal() {
  document.getElementById('authModal').classList.remove('hidden');
  switchAuthTab('login'); // começa na aba de login, não no cadastro
}

/*
  Fecha qualquer modal pelo seu ID.
  POR QUE uma função genérica em vez de funções específicas?
  → Reutilizável: fecha tanto authModal quanto postModal com a mesma função.
*/
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/*
  Fecha o modal ao clicar fora dele (no fundo escuro, chamado de "backdrop").
  event.target === o elemento clicado.
  Se o elemento clicado for o próprio backdrop (não o conteúdo interno), fecha.
*/
function closeModalOnBackdrop(event, id) {
  if (event.target === document.getElementById(id)) closeModal(id);
}

/*
  Alterna entre as abas "Entrar" e "Criar Conta" dentro do modal.
  POR QUE não fazer duas páginas/modais?
  → Mais fluido para o usuário: se errou de aba, muda sem reabrir nada.
*/
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
  document.getElementById('formLogin').classList.toggle('hidden', !isLogin);
  document.getElementById('formRegister').classList.toggle('hidden', isLogin);
}


// ===========================================================
// AUTENTICAÇÃO — LOGIN
// ===========================================================
/*
  Valida email e senha e loga o usuário.

  PASSO A PASSO:
  1. Lê os campos de email e senha
  2. Validação básica (campos não podem estar vazios)
  3. Verifica se é o administrador (credenciais fixas no código)
  4. Se não for admin, busca na lista de usuários do localStorage
  5. Se encontrou, faz o login; se não, mostra erro

  POR QUE verificar o admin separadamente?
  → O admin não está no localStorage (não foi "cadastrado").
    Precisa de tratamento especial. Também garante que alguém
    não consiga criar uma conta com o email do admin.
*/
/*
  SEGURANÇA (24/10/2026): agora é "async" porque calcular o hash da
  senha leva alguns milissegundos. Comparamos hashes, nunca a senha.
  Contas antigas que ainda têm a senha em texto são convertidas para
  hash no primeiro login que der certo.
*/
let loginEmAndamento = false; // impede cliques repetidos enquanto confere a senha
async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showToast('Preencha e-mail e senha!', 'error'); return; }
  if (loginEmAndamento) return;
  loginEmAndamento = true;
  try {
    // Verifica se é o administrador (conta virtual, não fica no localStorage)
    if (email === ADMIN.email) {
      if (await checkPassword(password, ADMIN.adminSalt, ADMIN.adminHash)) {
        loginUser({ id: 'admin', name: 'Administrador', email: ADMIN.email, isAdmin: true });
        closeModal('authModal');
        showToast('Bem-vindo, Administrador! 🐉', 'success');
        return;
      }
      showToast('E-mail ou senha incorretos!', 'error');
      return;
    }

    // Busca o usuário pelo e-mail e confere a senha pelo hash
    const users = getUsers();
    const idx   = users.findIndex(u => u.email === email);
    const user  = users[idx];
    let ok = false;
    if (user && user.passwordHash) {
      ok = await checkPassword(password, user.passwordSalt, user.passwordHash);
    } else if (user && typeof user.password === 'string' && sameText(user.password, password)) {
      // Conta antiga com senha em texto: troca por hash agora e apaga o texto
      const { hash, salt } = await hashPassword(password);
      users[idx] = { ...user, passwordHash: hash, passwordSalt: salt };
      delete users[idx].password;
      saveUsers(users);
      ok = true;
    }
    if (!ok) { showToast('E-mail ou senha incorretos!', 'error'); return; }

    loginUser(users[idx]);
    closeModal('authModal');
    showToast(`Bem-vindo de volta, ${users[idx].name}! 🐉`, 'success');
  } catch (e) {
    showToast(e.message || 'Não foi possível entrar agora.', 'error');
  } finally {
    loginEmAndamento = false;
  }
}


// ===========================================================
// AUTENTICAÇÃO — CADASTRO
// ===========================================================
/*
  Cria uma nova conta de usuário após validações.

  VALIDAÇÕES (em ordem):
  1. Todos os campos preenchidos
  2. Nome com mínimo 3 caracteres
  3. Email com "@" (validação simples)
  4. Senha com mínimo 6 caracteres
  5. Confirmação de senha igual à senha
  6. Email não cadastrado anteriormente (sem duplicatas)

  SEGURANÇA (24/10/2026): a senha não é mais guardada. Guardamos só
  o hash PBKDF2 + sal (veja hashPassword). Mesmo quem abrir o
  localStorage não consegue ler a senha de ninguém.
*/
async function handleRegister() {
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regConfirm').value;

  if (!name || !email || !password || !confirm) { showToast('Preencha todos os campos!', 'error'); return; }
  if (name.length < 3)       { showToast('Nome deve ter ao menos 3 caracteres!', 'error'); return; }
  if (!email.includes('@'))  { showToast('E-mail inválido!', 'error'); return; }
  if (password.length < 6)   { showToast('Senha deve ter ao menos 6 caracteres!', 'error'); return; }
  if (password !== confirm)  { showToast('As senhas não coincidem!', 'error'); return; }
  if (email.toLowerCase() === ADMIN.email.toLowerCase() || getUsers().find(u => u.email === email)) {
    showToast('Este e-mail já está cadastrado!', 'error'); return;
  }
  if (/[<>"'`]/.test(name)) { showToast('O nome não pode ter os símbolos < > " \' `', 'error'); return; }

  let senhaProtegida;
  try { senhaProtegida = await hashPassword(password); }
  catch (e) { showToast(e.message, 'error'); return; }

  // Cria o objeto do novo usuário (sem a senha: só o hash e o sal)
  const newUser = {
    id: 'user-' + Date.now(), // ID único baseado no timestamp atual (ms desde 1970)
    name, email,
    passwordHash: senhaProtegida.hash,
    passwordSalt: senhaProtegida.salt,
    createdAt: new Date().toLocaleDateString('pt-BR'), // data de criação formatada
  };

  // Adiciona o novo usuário à lista existente e salva
  const users = getUsers();
  users.push(newUser);
  saveUsers(users);

  // Faz login automático após o cadastro (UX mais fluida)
  loginUser(newUser);
  closeModal('authModal');
  showToast(`Conta criada! Bem-vindo, ${name}! 🐉`, 'success');
}


// ===========================================================
// AUTENTICAÇÃO — SESSÃO (manter login entre recarregamentos)
// ===========================================================
/*
  loginUser() atualiza a interface e salva a sessão.

  POR QUE sessionStorage e não localStorage para a sessão?
  → sessionStorage é apagado quando o browser fecha.
    localStorage persiste. Para sessão de login, preferimos que
    o usuário faça login novamente ao abrir o browser no dia seguinte
    (mais seguro). Se quiser "lembrar de mim", usaria localStorage.

  O QUE loginUser() faz na interface:
  1. Esconde o botão "Entrar"
  2. Mostra o avatar com a inicial do nome do usuário
  3. Se for admin, coloca borda dourada no avatar
  4. Exibe botões de criar post (Build, Guia, Novidade para admin)
  5. Renderiza o home e a página ativa com o contexto do usuário logado
*/
function loginUser(user) {
  // Usuários comuns nunca são admin, mesmo que o dado salvo diga o contrário
  if (user.id !== 'admin') user = { ...user, isAdmin: false };
  App.currentUser = user;
  // Salva a sessão: se a página recarregar, restoreSession() vai ler isso.
  // Só o id (e a marca do admin) — sem senha nem hash.
  sessionStorage.setItem('drk_session', JSON.stringify({ id: user.id, adminVerified: user.id === 'admin' }));

  document.getElementById('btnEntrar').classList.add('hidden');

  // Configura o avatar (ícone do usuário no canto superior direito)
  const avatar = document.getElementById('userAvatar');
  avatar.classList.remove('hidden');
  avatar.classList.toggle('is-admin', !!user.isAdmin); // borda dourada para admin
  document.getElementById('userMenuName').textContent = '👤 ' + user.name;
  refreshNavbarAvatar();
  // Exibe o sino e atualiza o contador de notificações não lidas
  document.getElementById('notifBell').classList.remove('hidden');
  renderNotificationBell();

  // Exibe botões de criar post para todos os usuários logados
  ['btnNewBuild','btnNewGuia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  });

  // Botão e menu de Novidades: apenas o administrador pode criar/ver
  const novidadeBtn  = document.getElementById('btnNewNovidade');
  const novidadeMenu = document.getElementById('menuItemNovidades');
  if (novidadeBtn)  novidadeBtn.classList.toggle('hidden',  !user.isAdmin);
  if (novidadeMenu) novidadeMenu.classList.toggle('hidden', !user.isAdmin);

  renderHome(); // atualiza o home (pode ter posts que agora são visíveis para este usuário)

  /*
    Re-renderiza a página ativa para refletir o contexto do usuário logado.
    POR QUE isso é necessário?
    → Se o usuário estava na página de Builds e fez login, os botões de
      editar/deletar precisam aparecer nos posts dele. Sem re-renderizar,
      a página ficaria desatualizada.
  */
  const activeId = document.querySelector('.page.active')?.id;
  if (activeId === 'page-detail' && App.currentDetailPostId) {
    showPostDetail(App.currentDetailPostId);
  } else if (activeId === 'page-builds')   renderPage('builds');
  else if (activeId === 'page-guias')      renderPage('guias');
  else if (activeId === 'page-novidades')  renderPage('novidades');
  else if (activeId === 'page-myposts')    renderMyPosts();
}

/*
  Faz logout: limpa o estado e a interface.
  POR QUE navegar para o home no logout?
  → Evita que o usuário fique em uma página que requer login
    (ex: "Minhas Postagens") sem estar logado, o que causaria erros.
*/
function logout() {
  App.currentUser = null;
  sessionStorage.removeItem('drk_session'); // apaga a sessão salva

  // Restaura a interface para o estado "deslogado"
  document.getElementById('btnEntrar').classList.remove('hidden');
  document.getElementById('notifBell').classList.add('hidden');
  document.getElementById('notifPanel').classList.add('hidden');
  const avatar = document.getElementById('userAvatar');
  avatar.classList.add('hidden');
  avatar.classList.remove('is-admin');

  // Esconde todos os botões de criação de post
  ['btnNewBuild','btnNewGuia','btnNewNovidade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const novidadeMenu = document.getElementById('menuItemNovidades');
  if (novidadeMenu) novidadeMenu.classList.add('hidden');

  showToast('Você saiu da conta. Até logo, Aventureiro!', 'info');
  showPage('home'); // volta para o home para evitar páginas sem contexto
}

/*
  Restaura a sessão ao recarregar a página.
  Chamada uma vez na inicialização (DOMContentLoaded).

  POR QUE try/catch?
  → Se o sessionStorage tiver dado corrompido, JSON.parse() lança erro.
    O try/catch impede que isso trave a inicialização do site.
*/
/*
  SEGURANÇA (24/10/2026): antes, o objeto salvo era usado direto. Quem
  editasse o sessionStorage podia escrever "isAdmin: true". Agora
  usamos só o id salvo e recarregamos o usuário da lista oficial.
  O admin só volta se a sessão foi criada por um login com senha
  conferida (campo adminVerified). Se algo não bater, a sessão é apagada.
*/
function restoreSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('drk_session') || 'null');
    if (!s || !isSafeId(s.id)) { sessionStorage.removeItem('drk_session'); return; }
    if (s.id === 'admin') {
      if (s.adminVerified === true) loginUser({ id: 'admin', name: 'Administrador', email: ADMIN.email, isAdmin: true });
      else sessionStorage.removeItem('drk_session');
      return;
    }
    const user = getUsers().find(u => u.id === s.id);
    if (user) loginUser(user); else sessionStorage.removeItem('drk_session');
  } catch(e) { sessionStorage.removeItem('drk_session'); }
}


// ===========================================================
// CRIAÇÃO DE POSTS — CONSTANTES DE CONFIGURAÇÃO
// ===========================================================
/*
  Cada seção do site aceita tags diferentes.
  POR QUE tags predefinidas em vez de texto livre?
  → Consistência: evita tags como "pve", "PVE", "P.V.E." que seriam
    a mesma coisa mas tratadas como diferentes.
    Também facilita a filtragem por tag.
*/
const TAG_OPTIONS = {
  novidades: ['ATUALIZAÇÃO', 'EVENTO', 'NOTÍCIAS'],
  builds:    ['PVE', 'PVP', 'FARM', 'ENDGAME'],
  guias:     ['INICIANTE', 'AVANÇADO', 'ECONOMIA', 'DUNGEON'],
};

/*
  Sugestões de emoji por seção.
  O primeiro da lista é pré-selecionado ao abrir o modal de novo post.
*/
const EMOJI_SUGGESTIONS = {
  novidades: ['📰','🔔','⚡','🔥','🎉','🏰'],
  builds:    ['⚔️','🏹','🔮','🛡️','🗡️','💥'],
  guias:     ['📖','💡','🗺️','💰','🏛️','🌟'],
};


// ===========================================================
// MODAL DE NOVO POST — ABRIR
// ===========================================================
/*
  Abre o formulário de criação de post para o tipo especificado.

  PASSO A PASSO:
  1. Verifica se o usuário está logado (pré-requisito)
  2. Verifica permissão especial para Novidades (só admin)
  3. Reseta o estado de edição (garante que é um post novo)
  4. Configura o título, campos e opções de tag para o tipo
  5. Exibe/oculta seções avançadas (Builds e Guias têm seções e YouTube)
  6. Abre o modal

  POR QUE extended (seções e YouTube) só para Builds e Guias?
  → Novidades são posts mais simples (texto + imagem de capa).
    Builds e Guias precisam de organização em seções (Atributos,
    Habilidades, etc.) e podem referenciar vídeos tutoriais.
*/
/*
  Redireciona para o editor Word-style em vez do modal antigo.
  Toda a lógica de criação está em startInlineCreate() abaixo.
*/
function openNewPostModal(type) {
  startInlineCreate(type);
}

// ===========================================================
// EDITOR WORD-STYLE — CRIAR NOVO POST
// ===========================================================
/*
  Abre o editor Word-style para criar um post completamente novo.
  Funciona da mesma forma que startInlineEdit(), mas com campos em branco
  e sem postId — o ID só é gerado na hora de salvar.

  POR QUE não usar o modal antigo?
  → O editor Word-style (contenteditable, hover controls, painel de config)
    é mais intuitivo e consistente com o modo de edição inline.
    Usar o mesmo editor para criar e editar evita duas interfaces diferentes.

  FLUXO:
  1. Verifica login e permissão (novidades = só admin)
  2. Inicializa estado com valores vazios
  3. Cria um "rascunho" template para o editor renderizar
  4. Exibe o editor na página de detalhe
*/
function startInlineCreate(type) {
  if (!App.currentUser) {
    openAuthModal();
    showToast('Faça login para criar um post!', 'info');
    return;
  }
  if (type === 'novidades' && !App.currentUser.isAdmin) {
    showToast('A seção de Novidades é gerenciada pela equipe Drakbuilder.', 'info');
    return;
  }

  // Inicializa estado limpo — sem ID (será gerado ao salvar)
  App.currentPostType     = type;
  App.selectedTags        = [];
  App.editingPostId       = null;   // null = criando novo, nunca editando existente
  App.inlineEditing       = true;
  App.postCardImage       = null;
  App.postSections        = [];
  App._ytEmbeddable       = null;
  App.currentDetailPostId = null;   // sem post aberto no histórico de navegação

  // Rascunho vazio: mesmo formato de um post salvo, mas com campos em branco
  const draft = {
    id:         null,               // null é o sinal de "novo post" em todo o editor
    type,
    title:      '',
    desc:       '',
    emoji:      EMOJI_SUGGESTIONS[type][0], // primeiro emoji sugerido para o tipo
    author:     App.currentUser.name,
    authorId:   App.currentUser.id,
    date:       new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    tags:       [],
    sections:   [],
    cardImage:  null,
    youtubeUrl: null,
  };

  renderPostDetail(draft); // renderiza o editor Word-style com o rascunho vazio
  showPage('detail');       // navega para a aba de detalhe (onde o editor está)
}

/*
  Adiciona ou remove uma tag da lista de tags selecionadas.
  Também atualiza o visual do botão (destacado = selecionado).
*/
function togglePostTag(tag, btn) {
  if (App.selectedTags.includes(tag)) {
    App.selectedTags = App.selectedTags.filter(t => t !== tag); // remove a tag
    btn.classList.remove('active');
  } else {
    App.selectedTags.push(tag); // adiciona a tag
    btn.classList.add('active');
  }
}


// ===========================================================
// GERENCIAR SEÇÕES DO POST
// ===========================================================
/*
  Seções dividem o conteúdo de Builds e Guias em partes organizadas.
  Ex: "Visão Geral", "Atributos", "Equipamentos"

  Cada seção tem:
  - id: identificador único (para o scroll da sidebar)
  - name: título da seção
  - content: texto da seção
  - images: até 5 imagens da seção

  POR QUE ID com Math.random()?
  → Date.now() garante unicidade em ms. Math.random().toString(36).slice(2,6)
    adiciona 4 caracteres aleatórios como extra de segurança contra colisões
    se duas seções forem criadas no mesmo milissegundo.
*/
function addSection() {
  App.postSections.push({
    id: 'sec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: '', content: '', images: [],
  });
  renderSectionEditors(); // atualiza a lista de campos de seção na tela
}

/*
  Remove uma seção pelo índice (posição no array).
  splice(idx, 1) remove 1 elemento na posição idx.
*/
function removeSection(idx) {
  App.postSections.splice(idx, 1);
  renderSectionEditors();
}

// ===========================================================
// DRAG-AND-DROP DE IMAGENS ENTRE SEÇÕES
// ===========================================================
/*
  COMO FUNCIONA:
  Cada imagem na grade do editor tem draggable="true".
  Ao iniciar o arrasto, _dragImg guarda qual imagem está se movendo
  ({ secIdx, imgIdx }). Ao soltar sobre outra imagem, a imagem
  arrastada é inserida antes dela — reordenando ou movendo de seção.
  Ao soltar na zona de drop no final da seção, a imagem vai para o fim.
*/

/*
  Estado global do drag: identifica qual imagem está sendo arrastada.
  null quando nenhum arrasto está em andamento.
*/
let _dragImg = null;

/* Inicia o arrasto — registra qual imagem está sendo movida.
   POR QUE setTimeout 0?
   → O browser captura o "ghost" da imagem ANTES de aplicar estilos ao elemento.
     Com o delay mínimo, o ghost fica com a aparência original e só depois
     o elemento fica semitransparente — experiência visual mais clara. */
function _imgDragStart(e, secIdx, imgIdx) {
  _dragImg = { secIdx, imgIdx };
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget.classList.add('img-dragging'), 0);
}

/* Finaliza o arrasto — remove estilo e limpa o estado global */
function _imgDragEnd(e) {
  e.currentTarget.classList.remove('img-dragging');
  _dragImg = null;
}

/* Necessário para que ondrop funcione: sem preventDefault em dragover, o browser
   cancela o drop por padrão (comportamento de segurança do HTML5). */
function _imgDragOver(e) {
  if (!_dragImg) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('img-drop-over');
}
function _imgDragLeave(e) { e.currentTarget.classList.remove('img-drop-over'); }

/* Solta a imagem ANTES do item alvo — reordena ou move entre seções.
   POR QUE ajustar dstIdx?
   → splice() remove o item do array de origem, deslocando os índices.
     Se origem e destino são a mesma seção e o item de origem estava
     ANTES do destino, o destino "subiu" 1 posição — compensamos com -1. */
function _imgDrop(e, secIdx, imgIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('img-drop-over');
  if (!_dragImg) return;
  const src = _dragImg;
  _dragImg  = null;
  if (src.secIdx === secIdx && src.imgIdx === imgIdx) return; // mesmo lugar

  const srcArr = App.postSections[src.secIdx].images;
  const dstArr = App.postSections[secIdx].images;
  const [img]  = srcArr.splice(src.imgIdx, 1);

  let dstIdx = imgIdx;
  if (src.secIdx === secIdx && src.imgIdx < imgIdx) dstIdx--;
  dstArr.splice(dstIdx, 0, img);

  /* No modo WYSIWYG, reconstrói apenas as grades de imagem (preserva o texto editável).
     No modo modal, reconstrói o formulário de seções completo. */
  if (App.inlineEditing) ieRebuildImgGrids();
  else renderSectionEditors();
}

/* Drag sobre a zona de drop no final de uma seção */
function _zoneDragOver(e) {
  if (!_dragImg) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('img-drop-over');
}
function _zoneDragLeave(e) { e.currentTarget.classList.remove('img-drop-over'); }

/* Solta no final de uma seção — move imagem para o final da lista daquela seção */
function _zoneDrop(e, secIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('img-drop-over');
  if (!_dragImg) return;
  const src = _dragImg;
  _dragImg  = null;
  const [img] = App.postSections[src.secIdx].images.splice(src.imgIdx, 1);
  App.postSections[secIdx].images.push(img);
  if (App.inlineEditing) ieRebuildImgGrids();
  else renderSectionEditors();
}

/*
  Gera o HTML interno da grade de imagens de uma seção.
  Separado em função própria para ser reusado em updateSectionImgGrid()
  (atualização parcial após upload) sem precisar reconstruir o formulário inteiro.

  draggable="false" na <img> é necessário: sem ele, o browser inicia um arrasto
  da imagem em vez do arrasto do container div — quebrando o drag-and-drop.
*/
function _buildImgGrid(secIdx) {
  const imgs = App.postSections[secIdx]?.images || [];
  return imgs.map((src, j) => `
    <div class="sec-img-item" draggable="true"
      ondragstart="_imgDragStart(event,${secIdx},${j})"
      ondragend="_imgDragEnd(event)"
      ondragover="_imgDragOver(event)"
      ondragleave="_imgDragLeave(event)"
      ondrop="_imgDrop(event,${secIdx},${j})">
      <img src="${src}" alt="imagem ${j+1}" draggable="false">
      <button class="sec-img-remove" onclick="removeSectionImage(${secIdx},${j})" title="Remover imagem">✕</button>
    </div>`).join('');
}


/*
  Gera o HTML dos campos de edição de todas as seções.
  Chamada sempre que uma seção é adicionada, removida ou reordenada.

  POR QUE oninput="App.postSections[${i}].name = this.value"?
  → Atualiza o objeto em memória em tempo real enquanto o usuário digita.
    Sem isso, os dados no formulário e em App.postSections ficariam desincronizados.
    Alternativa seria ler os campos ao salvar, mas oninput é mais simples aqui.
*/
function renderSectionEditors() {
  const list = document.getElementById('sectionEditorList');
  if (!list) return;

  list.innerHTML = App.postSections.map((sec, i) => {
    const imgs = sec.images || [];
    return `
      <div class="section-editor-block">
        <div class="section-editor-header">
          <input class="section-editor-name" type="text" placeholder="Nome da seção..."
            value="${escapeHtml(sec.name)}"
            oninput="App.postSections[${i}].name = this.value" />
          ${App.postSections.length > 1
            ? `<button class="section-editor-remove" onclick="removeSection(${i})" title="Remover seção">✕</button>`
            : ''}
        </div>
        <textarea class="section-editor-content" rows="4"
          placeholder="Conteúdo desta seção..."
          oninput="App.postSections[${i}].content = this.value">${escapeHtml(sec.content)}</textarea>
        <div class="section-images-row">
          <span class="section-images-label">
            Imagens desta seção
            ${imgs.length > 0 ? '<span class="img-drag-hint"> — arraste para reposicionar ou mover entre seções</span>' : ''}
          </span>
          <div class="sec-img-grid" id="sectionImgGrid-${i}">${_buildImgGrid(i)}</div>
          <div class="sec-img-dropzone"
            ondragover="_zoneDragOver(event)"
            ondragleave="_zoneDragLeave(event)"
            ondrop="_zoneDrop(event,${i})">
            ${imgs.length === 0 ? '🖼️ Arraste uma imagem aqui ou use o botão abaixo' : '↓ Solte aqui para adicionar ao final desta seção'}
          </div>
          <label class="image-upload-btn" id="sectionImgLabel-${i}" ${imgs.length >= 5 ? 'style="display:none"' : ''}>
            🖼️ Adicionar Imagem
            <input type="file" accept="image/*" style="display:none" onchange="handleSectionImageUpload(${i},event)" />
          </label>
        </div>
      </div>`;
  }).join('');
}


// ===========================================================
// IMAGEM DE CAPA DO CARD (post card image)
// ===========================================================
/*
  O card de um post pode ter uma imagem de capa (thumbnail).
  Ao selecionar um arquivo, ele é lido como Base64 (texto que
  representa a imagem em binário codificado).

  POR QUE Base64 em vez de URL?
  → Sem servidor, não temos onde hospedar arquivos de imagem.
    Base64 permite guardar a imagem diretamente no localStorage
    como uma string muito longa. A desvantagem é que ocupa muito
    espaço (localStorage tem limite de ~5MB por domínio).

  FileReader:
  → API do browser para ler arquivos locais sem enviar para servidor.
    reader.onload é chamado quando a leitura termina.
    e.target.result contém a imagem em formato data:image/jpeg;base64,...
*/
function handleCardImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { App.postCardImage = e.target.result; updateCardImagePreview(); };
  reader.readAsDataURL(file); // lê o arquivo como URL de dados (Base64)
  event.target.value = ''; // limpa o input para permitir selecionar o mesmo arquivo novamente
}

/* Remove a imagem de capa do estado e atualiza a prévia */
function removeCardImage() {
  App.postCardImage = null;
  updateCardImagePreview();
}

/*
  Atualiza a prévia visual da imagem de capa no formulário.
  Se há imagem: exibe a miniatura com botão de remover.
  Se não há: exibe o botão de selecionar imagem.
*/
function updateCardImagePreview() {
  const preview = document.getElementById('cardImagePreview');
  const label   = document.getElementById('cardImageLabel');
  if (!preview) return;

  if (App.postCardImage) {
    preview.innerHTML = `
      <div class="card-image-preview">
        <img src="${App.postCardImage}" alt="imagem do card" />
        <button class="image-preview-remove" onclick="removeCardImage()" title="Remover">✕</button>
      </div>`;
    if (label) label.style.display = 'none'; // esconde o botão "Adicionar Imagem"
  } else {
    preview.innerHTML = '';
    if (label) label.style.display = ''; // mostra o botão "Adicionar Imagem"
  }
}


// ===========================================================
// IMAGENS POR SEÇÃO
// ===========================================================
/*
  Cada seção pode ter até 5 imagens.

  Array.from(event.target.files) → converte a lista de arquivos
  selecionados (FileList) para um array comum de JavaScript,
  permitindo usar .slice() e .forEach().

  .slice(0, remaining) → garante que não ultrapasse o limite de 5.
*/
function handleSectionImageUpload(sectionIdx, event) {
  const section   = App.postSections[sectionIdx];
  if (!section) return;
  if (!section.images) section.images = [];

  const remaining = 5 - section.images.length; // quantas imagens ainda cabem
  if (remaining <= 0) { showToast('Limite de 5 imagens por seção atingido!', 'error'); event.target.value = ''; return; }

  // Processa cada arquivo selecionado (respeitando o limite)
  Array.from(event.target.files).slice(0, remaining).forEach(f => {
    const reader = new FileReader();
    reader.onload = e => {
      section.images.push(e.target.result); // adiciona a imagem em Base64
      updateSectionImgGrid(sectionIdx);     // atualiza a grade de miniaturas
    };
    reader.readAsDataURL(f);
  });
  event.target.value = ''; // limpa o input
}

/* Remove uma imagem específica de uma seção */
function removeSectionImage(sectionIdx, imgIdx) {
  const section = App.postSections[sectionIdx];
  if (!section || !section.images) return;
  section.images.splice(imgIdx, 1); // remove 1 imagem na posição imgIdx
  updateSectionImgGrid(sectionIdx);
}

/*
  Atualiza a grade de imagens de uma seção sem reconstruir o formulário inteiro.

  POR QUE não chamar renderSectionEditors() aqui?
  → Essa função é chamada logo após um upload de imagem — reconstruir todo o
    formulário perderia o foco do textarea que o admin pode estar editando.
    Com atualização parcial (apenas a grade), o resto do formulário fica intacto.
*/
function updateSectionImgGrid(sectionIdx) {
  const section = App.postSections[sectionIdx];
  const imgs    = section?.images || [];
  const grid    = document.getElementById(`sectionImgGrid-${sectionIdx}`);
  const label   = document.getElementById(`sectionImgLabel-${sectionIdx}`);
  if (!grid) return;

  // Reconstrói apenas os itens da grade com drag-and-drop
  grid.innerHTML = _buildImgGrid(sectionIdx);

  // Atualiza o texto da zona de drop logo abaixo da grade
  const zone = grid.nextElementSibling;
  if (zone?.classList.contains('sec-img-dropzone')) {
    zone.textContent = imgs.length === 0
      ? '🖼️ Arraste uma imagem aqui ou use o botão abaixo'
      : '↓ Solte aqui para adicionar ao final desta seção';
  }

  // Oculta o botão de upload quando o limite de 5 imagens é atingido
  if (label) label.style.display = imgs.length >= 5 ? 'none' : '';
}


// ===========================================================
// YOUTUBE — EXTRAIR ID DO VÍDEO
// ===========================================================
/*
  Aceita qualquer formato de URL do YouTube e extrai o ID de 11 caracteres:
  - youtube.com/watch?v=dQw4w9WgXcW
  - youtu.be/dQw4w9WgXcW
  - youtube.com/embed/dQw4w9WgXcW

  O ID é usado para gerar a URL de embed: youtube.com/embed/ID
  POR QUE regex?
  → Os três formatos de URL têm partes diferentes antes do ID.
    A regex consegue capturar os três casos com uma única expressão.
    ([a-zA-Z0-9_-]{11}) = exatamente 11 caracteres alfanuméricos/hífen/underscore
*/
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null; // retorna o ID capturado, ou null se URL inválida
}


// ===========================================================
// VERIFICAÇÃO DE EMBED DO YOUTUBE
// ===========================================================
/*
  Verifica se um vídeo do YouTube permite ser incorporado (embedded)
  em outros sites antes de salvar o post.

  POR QUE VERIFICAR?
  Alguns donos de vídeo desabilitam a opção "Permitir incorporação"
  no YouTube. Se tentarmos incorporar esses vídeos com <iframe>,
  o player exibe "Erro 153 — Erro de configuração do player de vídeo".
  Verificando antes, podemos avisar o usuário e salvar o vídeo
  como link clicável em vez de iframe quebrado.

  COMO FUNCIONA A VERIFICAÇÃO?
  Usamos a API pública oEmbed do YouTube:
    https://www.youtube.com/oembed?url=...&format=json
  — HTTP 200: vídeo existe e incorporação é permitida
  — HTTP 401: incorporação desabilitada pelo dono
  — HTTP 404: vídeo não encontrado ou privado
  Nenhuma chave de API é necessária.

  POR QUE DEBOUNCE (espera de 800ms)?
  O usuário pode estar digitando ou colando a URL caractere por caractere.
  Sem debounce, cada tecla dispararia uma requisição de rede desnecessária.
  Com o debounce, esperamos 800ms de silêncio antes de consultar o YouTube.
*/
async function checkYouTubeEmbed(url) {
  const statusEl = document.getElementById('ytCheckStatus');
  if (!statusEl) return;

  // Campo vazio: sem verificação, esconde o status
  if (!url.trim()) {
    App._ytEmbeddable  = null;
    statusEl.style.display = 'none';
    return;
  }

  const id = extractYouTubeId(url);

  // URL digitada mas não reconhecida como YouTube válido
  if (!id) {
    App._ytEmbeddable  = null;
    statusEl.style.display = '';
    statusEl.className = 'yt-check-status yt-check-error';
    statusEl.textContent = '❌ URL inválida — use youtube.com/watch?v=... ou youtu.be/...';
    return;
  }

  // Mostra indicador de carregamento enquanto consulta o YouTube
  App._ytEmbeddable  = null;
  statusEl.style.display = '';
  statusEl.className = 'yt-check-status yt-check-loading';
  statusEl.textContent = '⏳ Verificando vídeo...';

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`
    );

    if (res.ok) {
      // Vídeo existe e incorporação está habilitada
      App._ytEmbeddable = true;
      statusEl.className = 'yt-check-status yt-check-ok';
      statusEl.textContent = '✅ Vídeo verificado — incorporação permitida';

    } else if (res.status === 401 || res.status === 403) {
      // Incorporação desabilitada pelo dono do vídeo
      App._ytEmbeddable = false;
      statusEl.className = 'yt-check-status yt-check-warn';
      statusEl.textContent = '⚠️ Este vídeo não permite incorporação — aparecerá como miniatura clicável para o YouTube';

    } else if (res.status === 404) {
      // Vídeo não existe ou está privado
      App._ytEmbeddable = null;
      statusEl.className = 'yt-check-status yt-check-error';
      statusEl.textContent = '❌ Vídeo não encontrado — verifique se é público';

    } else {
      // Outro código HTTP inesperado
      App._ytEmbeddable = null;
      statusEl.className = 'yt-check-status yt-check-warn';
      statusEl.textContent = `⚠️ Não foi possível verificar (código ${res.status})`;
    }

  } catch {
    // Falha de rede (sem internet, CORS bloqueado, etc.)
    App._ytEmbeddable = null;
    statusEl.className = 'yt-check-status yt-check-warn';
    statusEl.textContent = '⚠️ Sem conexão para verificar o vídeo — será exibido normalmente';
  }
}


// ===========================================================
// SALVAR POST (criar ou editar)
// ===========================================================
/*
  Função principal de salvamento — cria um novo post ou atualiza um existente.

  DECIDE SE É CRIAR OU EDITAR com base em App.editingPostId:
  - null: cria novo post
  - algum ID: encontra esse post e atualiza

  POR QUE posts.unshift() para novos posts?
  → unshift() adiciona no início do array, então o post mais recente
    aparece primeiro nas listagens (ordem cronológica reversa).

  POR QUE ...posts[idx] (spread) na edição?
  → O spread copia todos os campos existentes do post.
    Depois substituímos apenas os que foram editados.
    Isso preserva campos que não estão no formulário
    (como timestamp original, authorId, etc.).
*/
function handleSavePost() {
  const title      = document.getElementById('postTitle').value.trim();
  const desc       = document.getElementById('postDesc').value.trim();
  const emoji      = document.getElementById('postEmoji').value.trim() || '📝';
  const youtubeUrl = document.getElementById('postYoutube').value.trim();

  // Validações antes de salvar
  if (!title)           { showToast('O título é obrigatório!', 'error'); return; }
  if (!desc)            { showToast('A descrição é obrigatória!', 'error'); return; }
  if (title.length < 5) { showToast('Título muito curto!', 'error'); return; }

  // Prepara as seções (apenas para Builds e Guias)
  const extended = App.currentPostType === 'builds' || App.currentPostType === 'guias';
  const sections = extended
    ? App.postSections
        .map((s, i) => ({
          id:      s.id,
          name:    s.name.trim() || `Seção ${i + 1}`, // usa "Seção N" se o nome estiver vazio
          content: s.content.trim(),
          images:  [...(s.images || [])],              // cópia do array de imagens
        }))
        .filter(s => s.content || s.images.length > 0) // remove seções completamente vazias
    : [];

  const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  if (App.editingPostId) {
    // ── MODO EDIÇÃO: atualiza post existente ──
    const posts = getPosts();
    const idx   = posts.findIndex(p => p.id === App.editingPostId);
    if (idx !== -1) {
      posts[idx] = {
        ...posts[idx], // mantém todos os campos originais (timestamp, author, etc.)
        title, desc, emoji,
        tags:       [...App.selectedTags],
        cardImage:  App.postCardImage || null,
        sections,
        youtubeUrl:        youtubeUrl || null,
        youtubeEmbeddable: youtubeUrl ? App._ytEmbeddable : null,
      };
      savePosts(posts);
      closeModal('postModal');
      showToast('Post atualizado! 🐉', 'success');
      renderPage(App.currentPostType);
      renderHome();
      renderMyPosts();
      showPostDetail(App.editingPostId); // reabre o detalhe do post editado
    }
    return;
  }

  // ── MODO CRIAÇÃO: novo post ──
  const newPost = {
    id:         'post-' + Date.now(),
    type:       App.currentPostType,
    title, desc, emoji,
    tags:       [...App.selectedTags],
    author:     App.currentUser.name,
    authorId:   App.currentUser.id,
    date:       dateStr,
    timestamp:  Date.now(),
    cardImage:         App.postCardImage || null,
    sections,
    youtubeUrl:        youtubeUrl || null,
    youtubeEmbeddable: youtubeUrl ? App._ytEmbeddable : null,
  };

  const posts = getPosts();
  posts.unshift(newPost); // adiciona no início (mais recente primeiro)
  savePosts(posts);

  closeModal('postModal');
  showToast('Post publicado com sucesso! 🐉', 'success');
  renderPage(App.currentPostType);
  renderHome();
  renderMyPosts();

  // Notifica todos os seguidores do autor sobre o novo post
  const followers = getFollowers(App.currentUser.id);
  const typeLabel = { builds: 'Build', guias: 'Guia' }[newPost.type] || 'Post';
  followers.forEach(followerId => {
    pushNotification(followerId, {
      type:         'new_post',
      fromUserId:   App.currentUser.id,
      fromUserName: App.currentUser.name,
      postId:       newPost.id,
      postTitle:    newPost.title,
      postType:     newPost.type,
      typeLabel,
      timestamp:    Date.now(),
    });
  });
  // Se o próprio usuário está logado e é seguido por si mesmo (impossível, mas defensivo)
  renderNotificationBell();

  if (extended) showPostDetail(newPost.id);
}


// ===========================================================
// ABRIR MODAL EM MODO EDIÇÃO
// ===========================================================
/*
  Pré-preenche o formulário com os dados do post existente.

  PERMISSÕES:
  - Dono do post: pode editar qualquer post seu
  - Admin: pode editar posts de Novidades (controle editorial)
  - Outros: sem acesso
*/
function openEditPostModal(postId) {
  const post    = getPosts().find(p => p.id === postId);
  if (!post) return;

  const isAdmin = App.currentUser?.isAdmin;
  const isOwner = App.currentUser && App.currentUser.id === post.authorId;
  const canEdit = isOwner || (isAdmin && post.type === 'novidades');

  if (!canEdit) {
    showToast('Sem permissão para editar este post!', 'error');
    return;
  }

  // Preenche o estado de edição
  App.currentPostType = post.type;
  App.selectedTags    = [...post.tags];       // cópia do array de tags
  App.editingPostId   = postId;               // define que estamos editando
  App.postCardImage   = post.cardImage || null;
  // Cópia profunda das seções (evita modificar o post original antes de salvar)
  App.postSections    = (post.sections || []).map(s => ({ ...s, images: [...(s.images || [])] }));

  const names = { novidades: 'Novidades', builds: 'Builds', guias: 'Guias' };
  document.getElementById('postModalTitle').textContent = '✏️ Editar Post';
  document.getElementById('postSection').value = names[post.type];
  document.getElementById('postTitle').value   = post.title;
  document.getElementById('postDesc').value    = post.desc;
  document.getElementById('postEmoji').value   = post.emoji;
  document.getElementById('postYoutube').value = post.youtubeUrl || '';
  // Restaura o resultado de verificação salvo com o post, e re-verifica visualmente
  App._ytEmbeddable = post.youtubeEmbeddable !== undefined ? post.youtubeEmbeddable : null;
  setTimeout(() => checkYouTubeEmbed(post.youtubeUrl || ''), 100);

  // Gera botões de tag com os já selecionados destacados
  const tagsContainer = document.getElementById('postTagsContainer');
  tagsContainer.innerHTML = '';
  TAG_OPTIONS[post.type].forEach(tag => {
    const btn = document.createElement('button');
    btn.textContent   = tag;
    btn.className     = 'filter-btn';
    btn.style.cssText = 'border-radius:4px;font-size:.68rem';
    if (App.selectedTags.includes(tag)) btn.classList.add('active'); // destaca tags já selecionadas
    btn.onclick = () => togglePostTag(tag, btn);
    tagsContainer.appendChild(btn);
  });

  updateCardImagePreview();

  const extended = post.type === 'builds' || post.type === 'guias';
  document.getElementById('sectionsGroup').style.display = extended ? '' : 'none';
  document.getElementById('youtubeGroup').style.display  = extended ? '' : 'none';

  if (extended) {
    if (App.postSections.length === 0) addSection(); // garante pelo menos 1 seção
    else renderSectionEditors();                      // renderiza seções existentes
  }

  document.querySelector('#postModal .btn-primary').textContent = '💾 Salvar Alterações';
  document.getElementById('postModal').classList.remove('hidden');
}


// ===========================================================
// EDIÇÃO INLINE — diretamente na página de detalhe
// ===========================================================
/*
  Em vez de abrir um modal separado, o admin edita o post diretamente
  na página de detalhe. O layout se transforma num editor in-place
  com campos sobre o próprio conteúdo — mesma posição, mesma hierarquia.

  FLUXO:
  1. startInlineEdit(postId) ou startInlineCreate(type) → prepara o estado e renderiza o editor
  2. O usuário edita título, resumo, tags, imagens e seções diretamente na tela
  3. saveInlineEdit()   → salva (cria ou atualiza) e volta para visualização
  4. cancelInlineEdit() → descarta e volta para a visualização ou seção
*/

/*
  Ativa o modo de edição inline para o post informado.
  Popula App.postSections, App.selectedTags, App.postCardImage
  com os dados atuais do post — idêntico ao que openEditPostModal faz,
  mas em vez de abrir o modal, re-renderiza a página de detalhe em modo editor.
*/
function startInlineEdit(postId) {
  const post = getPosts().find(p => p.id === postId);
  if (!post) return;

  const isAdmin = App.currentUser?.isAdmin;
  const isOwner = App.currentUser && App.currentUser.id === post.authorId;
  if (!isOwner && !(isAdmin && post.type === 'novidades')) {
    showToast('Sem permissão para editar este post!', 'error');
    return;
  }

  // Prepara estado de edição — cópia profunda para não modificar o post original
  App.currentPostType = post.type;
  App.selectedTags    = [...post.tags];
  App.editingPostId   = postId;
  App.inlineEditing   = true;
  App.postCardImage   = post.cardImage || null;
  App.postSections    = (post.sections || []).map(s => ({ ...s, images: [...(s.images || [])] }));
  App._ytEmbeddable   = post.youtubeEmbeddable !== undefined ? post.youtubeEmbeddable : null;

  renderPostDetail(post); // renderiza a página de detalhe em modo editor
}

/*
  Descarta as alterações e sai do editor Word-style.
  - Se estava editando um post existente (App.editingPostId != null):
    volta para a visualização normal daquele post.
  - Se estava criando um novo post (App.editingPostId === null):
    volta para a seção correspondente (Builds, Guias ou Novidades).
  POR QUE ler App.editingPostId em vez de receber como parâmetro?
  → Evita passar 'null' como string nos atributos HTML onclick.
    O estado sempre reflete a situação atual de forma confiável.
*/
function cancelInlineEdit() {
  const postId = App.editingPostId;  // null = estava criando, string = estava editando
  const type   = App.currentPostType;
  App.inlineEditing = false;
  App.editingPostId = null;
  App.postSections  = [];
  if (postId) {
    // Estava editando — volta para a visualização do post original
    const post = getPosts().find(p => p.id === postId);
    if (post) renderPostDetail(post);
  } else {
    // Estava criando — descarta e volta para a seção
    showPage(type);
  }
}

/*
  Abre ou fecha o painel de configurações (tags, capa, YouTube).
  O painel fica escondido por padrão para manter o visual de documento Word.
  Ao clicar no botão ⚙️ Config na barra superior, a classe ie-sp-open é
  adicionada e o CSS muda display de none para flex, revelando o painel.
*/
function ieToggleSettings() {
  const panel = document.getElementById('ie-settings-panel');
  if (panel) panel.classList.toggle('ie-sp-open');
}


// ===========================================================
// WYSIWYG — funções auxiliares do editor inline
// ===========================================================
/*
  Todas as funções abaixo operam diretamente no DOM da página de detalhe
  em modo de edição, evitando reconstruir a página inteira e preservando
  o cursor do admin nos campos de texto contenteditable.
*/

/*
  Gera o HTML de todas as seções no modo WYSIWYG.
  Visual idêntico ao leitor (detail-section, detail-section-title, detail-section-content)
  mas com contenteditable e drag nas imagens.
*/
function ieRenderSections() {
  // Garante pelo menos uma seção vazia para o admin começar a escrever
  if (App.postSections.length === 0) {
    App.postSections.push({
      id: 'sec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: '', content: '', images: [],
    });
  }
  /*
    Cada seção é envolvida em .ie-section-wrap, que tem position:relative.
    Os controles flutuantes (.ie-sec-controls) ficam invisíveis até o hover —
    esse comportamento é controlado 100% por CSS (opacity + pointer-events),
    sem nenhum listener de JavaScript necessário. Estilo Word/Notion.
  */
  return App.postSections.map((s, i) => `
    <div class="ie-section-wrap" id="ie-sec-${i}">

      <!-- Controles flutuantes: aparecem apenas quando o mouse está na seção -->
      <div class="ie-sec-controls">
        <label class="ie-small-btn" title="Adicionar imagens a esta seção" style="cursor:pointer">
          🖼️
          <input type="file" accept="image/*" multiple style="display:none"
            onchange="ieAddSectionImages(${i},event)">
        </label>
        <button class="ie-del-sec-btn" onclick="ieRemoveSection(${i})" title="Remover seção">
          ✕ Remover
        </button>
      </div>

      <!-- Título da seção: contenteditable com visual idêntico ao modo leitura -->
      <h2 class="detail-section-title" style="display:flex;align-items:center;gap:.4rem">
        <span style="color:var(--gold);flex-shrink:0">◆</span>
        <span class="ie-ce ie-sec-name" contenteditable="true"
          spellcheck="false" data-idx="${i}">${escapeHtml(s.name || '')}</span>
      </h2>

      <!-- Corpo da seção: editável com a mesma fonte e espaçamento do leitor -->
      <div class="detail-section-content ie-ce ie-sec-content"
        contenteditable="true" spellcheck="true" data-idx="${i}"
        style="min-height:2.5rem">${escapeHtml(s.content)}</div>

      <!-- Grade de imagens com arrastar para reposicionar -->
      <div id="ie-img-grid-${i}">${ieRenderImgGrid(i)}</div>
    </div>`).join('');
}

/*
  Gera a grade de imagens de uma seção: visual igual ao leitor, mas
  com drag-and-drop, botão de remover e botão de adicionar.
*/
function ieRenderImgGrid(secIdx) {
  /*
    Gera apenas a grade de imagens — o botão "adicionar imagem" agora fica
    nos controles flutuantes (.ie-sec-controls), visíveis só no hover.
    A div .sec-img-grid existe mesmo quando não há imagens para servir como
    zona de drop (o admin pode arrastar imagens de outras seções para cá).
  */
  const imgs = App.postSections[secIdx]?.images || [];
  const items = imgs.map((src, j) => `
    <div class="sec-img-item" draggable="true"
      ondragstart="_imgDragStart(event,${secIdx},${j})"
      ondragend="_imgDragEnd(event)"
      ondragover="_imgDragOver(event)"
      ondragleave="_imgDragLeave(event)"
      ondrop="_imgDrop(event,${secIdx},${j})">
      <img src="${src}" alt="imagem ${j+1}" draggable="false">
      <button class="sec-img-remove" onclick="ieRemoveImg(${secIdx},${j})" title="Remover">✕</button>
    </div>`).join('');
  return `
    <div class="sec-img-grid"
      ondragover="_zoneDragOver(event)"
      ondragleave="_zoneDragLeave(event)"
      ondrop="_zoneDrop(event,${secIdx})">
      ${items}
    </div>
    ${imgs.length > 0 ? '<p class="img-drag-hint" style="font-size:.72rem;color:var(--text-muted);margin:.25rem 0 0"> — arraste para reposicionar</p>' : ''}`;
}

/*
  Reconstrói APENAS as grades de imagem de todas as seções,
  sem tocar nos elementos contenteditable — preserva o cursor de texto.
*/
function ieRebuildImgGrids() {
  App.postSections.forEach((_, i) => {
    const el = document.getElementById(`ie-img-grid-${i}`);
    if (el) el.innerHTML = ieRenderImgGrid(i);
  });
}

/*
  Lê o conteúdo dos contenteditable de volta para App.postSections.
  Chamada antes de qualquer operação que reconstrói o DOM das seções
  (adicionar, remover seção) para não perder o que o admin digitou.
*/
function ieSyncFromDOM() {
  document.querySelectorAll('.ie-sec-name').forEach(el => {
    const i = +el.dataset.idx;
    if (!isNaN(i) && App.postSections[i]) App.postSections[i].name = el.textContent.trim();
  });
  document.querySelectorAll('.ie-sec-content').forEach(el => {
    const i = +el.dataset.idx;
    if (!isNaN(i) && App.postSections[i]) App.postSections[i].content = el.textContent;
  });
}

/* Registra listeners oninput nos contenteditable para manter App.postSections atualizado */
function ieAttachListeners() {
  document.querySelectorAll('.ie-sec-name').forEach(el => {
    el.addEventListener('input', function () {
      const i = +this.dataset.idx;
      if (!isNaN(i) && App.postSections[i]) App.postSections[i].name = this.textContent.trim();
    });
  });
  document.querySelectorAll('.ie-sec-content').forEach(el => {
    el.addEventListener('input', function () {
      const i = +this.dataset.idx;
      if (!isNaN(i) && App.postSections[i]) App.postSections[i].content = this.textContent;
    });
  });
}

/* Adiciona uma seção vazia ao final */
function ieAddSection() {
  ieSyncFromDOM();
  App.postSections.push({
    id:      'sec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name:    '',
    content: '',
    images:  [],
  });
  const c = document.getElementById('ie-sections-container');
  if (c) { c.innerHTML = ieRenderSections(); ieAttachListeners(); }
}

/* Remove uma seção pelo índice — sincroniza primeiro para não perder texto */
function ieRemoveSection(idx) {
  ieSyncFromDOM();
  App.postSections.splice(idx, 1);
  const c = document.getElementById('ie-sections-container');
  if (c) { c.innerHTML = ieRenderSections(); ieAttachListeners(); }
}

/* Remove uma imagem de uma seção e reconstrói apenas as grades */
function ieRemoveImg(secIdx, imgIdx) {
  App.postSections[secIdx]?.images.splice(imgIdx, 1);
  ieRebuildImgGrids();
}

/* Upload de imagens para uma seção via botão */
function ieAddSectionImages(secIdx, event) {
  const sec = App.postSections[secIdx];
  if (!sec) return;
  if (!sec.images) sec.images = [];
  const remaining = 5 - sec.images.length;
  if (remaining <= 0) { showToast('Limite de 5 imagens por seção!', 'error'); return; }
  Array.from(event.target.files).slice(0, remaining).forEach(f => {
    const reader = new FileReader();
    reader.onload = e => { sec.images.push(e.target.result); ieRebuildImgGrids(); };
    reader.readAsDataURL(f);
  });
  event.target.value = '';
}

/* Remove a imagem de capa e atualiza apenas a área de capa no DOM */
function ieRemoveCover() {
  App.postCardImage = null;
  _ieRefreshCoverUI();
}

/* Upload de nova imagem de capa */
function ieUploadCover(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { App.postCardImage = e.target.result; _ieRefreshCoverUI(); };
  reader.readAsDataURL(file);
  event.target.value = '';
}

/* Atualiza apenas a área da capa no hero sem reconstruir a página inteira */
function _ieRefreshCoverUI() {
  const area = document.querySelector('.ie-cover-area');
  if (!area) return;
  area.innerHTML = `
    ${App.postCardImage ? `
      <img src="${App.postCardImage}" class="ie-cover-thumb" alt="capa">
      <button class="ie-small-btn" onclick="ieRemoveCover()">✕ Remover</button>` : ''}
    <label class="ie-small-btn">
      🖼️ ${App.postCardImage ? 'Trocar' : 'Adicionar'}
      <input type="file" accept="image/*" style="display:none" onchange="ieUploadCover(event)">
    </label>`;
}

/*
  Lê os campos do editor Word-style, valida e salva o post.
  Funciona para DOIS casos:
  - App.editingPostId != null → atualiza post existente
  - App.editingPostId === null → cria um post novo

  POR QUE sem parâmetro?
  → O estado já está disponível em App.editingPostId.
    Evita passar 'null' como string nos atributos HTML onclick.
*/
function saveInlineEdit() {
  // Garante que todos os contenteditable estão sincronizados antes de ler
  ieSyncFromDOM();

  const postId     = App.editingPostId; // null = criar, string = editar
  const title      = (document.getElementById('ie-title')?.textContent || '').trim();
  const desc       = (document.getElementById('ie-desc')?.textContent  || '').trim();
  const emoji      = (document.getElementById('ie-emoji')?.textContent || '📝').trim();
  const youtubeUrl = (document.getElementById('ie-youtube')?.value     || '').trim();

  if (!title)           { showToast('O título é obrigatório!',   'error'); return; }
  if (!desc)            { showToast('O resumo é obrigatório!',   'error'); return; }
  if (title.length < 5) { showToast('Título muito curto (mín. 5 caracteres)!', 'error'); return; }

  // Builds e Guias têm seções; Novidades não — seções ficam vazias
  const extended = App.currentPostType === 'builds' || App.currentPostType === 'guias';
  const sections = extended
    ? App.postSections
        .map((s, i) => ({
          id:      s.id,
          name:    s.name.trim() || `Seção ${i + 1}`,
          content: s.content.trim(),
          images:  [...(s.images || [])],
        }))
        .filter(s => s.content || s.images.length > 0) // descarta seções completamente vazias
    : [];

  // Limpa estado antes de salvar (evita estado residual se algo falhar depois)
  App.inlineEditing = false;
  App.editingPostId = null;
  App.postSections  = [];

  if (postId) {
    // ── MODO EDIÇÃO: atualiza post existente ────────────────────
    const posts = getPosts();
    const idx   = posts.findIndex(p => p.id === postId);
    if (idx === -1) { showToast('Post não encontrado!', 'error'); return; }

    posts[idx] = {
      ...posts[idx], // preserva timestamp, authorId, author, type, date originais
      title, desc, emoji,
      tags:              [...App.selectedTags],
      cardImage:         App.postCardImage || null,
      sections,
      youtubeUrl:        youtubeUrl || null,
      youtubeEmbeddable: youtubeUrl ? App._ytEmbeddable : null,
    };

    savePosts(posts);
    showToast('Post atualizado!', 'success');
    renderPage(posts[idx].type);
    renderHome();
    renderMyPosts();
    renderPostDetail(posts[idx]); // volta para a visualização do post

  } else {
    // ── MODO CRIAÇÃO: cria e salva novo post ────────────────────
    const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const newPost = {
      id:        'post-' + Date.now(),
      type:      App.currentPostType,
      title, desc, emoji,
      tags:      [...App.selectedTags],
      author:    App.currentUser.name,
      authorId:  App.currentUser.id,
      date:      dateStr,
      timestamp: Date.now(),
      cardImage:         App.postCardImage || null,
      sections,
      youtubeUrl:        youtubeUrl || null,
      youtubeEmbeddable: youtubeUrl ? App._ytEmbeddable : null,
    };

    const posts = getPosts();
    posts.unshift(newPost); // insere no início (mais recente primeiro)
    savePosts(posts);
    showToast('Post publicado! 🐉', 'success');
    renderPage(newPost.type);
    renderHome();
    renderMyPosts();

    // Notifica todos os seguidores do autor sobre o novo post
    const followers = getFollowers(App.currentUser.id);
    const typeLabel = { builds: 'Build', guias: 'Guia' }[newPost.type] || 'Post';
    followers.forEach(followerId => {
      pushNotification(followerId, {
        type:         'new_post',
        fromUserId:   App.currentUser.id,
        fromUserName: App.currentUser.name,
        postId:       newPost.id,
        postTitle:    newPost.title,
        postType:     newPost.type,
        typeLabel,
        timestamp:    Date.now(),
      });
    });
    renderNotificationBell();

    // Abre a visualização do post recém-criado
    showPostDetail(newPost.id);
  }
}


// ===========================================================
// DELETAR POST (a partir do card da grade)
// ===========================================================
/*
  event.stopPropagation() → impede que o clique no botão "deletar"
  dispare também o clique no card (que abriria a página de detalhe).
  Sem isso, deletar causaria uma animação estranha de abrir o post
  enquanto ele está sendo deletado.
*/
function deletePost(postId, event) {
  event.stopPropagation(); // não propaga o clique para o card pai
  if (!App.currentUser) return;

  const posts = getPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return;

  // Usuários comuns só podem deletar seus próprios posts
  if (post.authorId !== App.currentUser.id) {
    showToast('Você só pode deletar seus próprios posts!', 'error');
    return;
  }

  // confirm() abre uma caixa de diálogo nativa do browser pedindo confirmação
  if (!confirm(`Tem certeza que deseja deletar "${post.title}"?`)) return;

  savePosts(posts.filter(p => p.id !== postId)); // remove o post e salva o resto
  showToast('Post deletado!', 'info');
  renderPage(post.type);
  renderHome();
  renderMyPosts();
}


// ===========================================================
// DELETAR POST (a partir da página de detalhe)
// ===========================================================
/*
  Versão do delete chamada de dentro da página de detalhe.
  Após deletar, volta para a seção (Builds, Guias ou Novidades).
*/
function deletePostFromDetail(postId, type) {
  if (!App.currentUser) return;
  const posts = getPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post || post.authorId !== App.currentUser.id) return;
  if (!confirm(`Tem certeza que deseja deletar "${post.title}"?`)) return;
  savePosts(posts.filter(p => p.id !== postId));
  showToast('Post deletado!', 'info');
  renderPage(type);
  renderHome();
  showPage(type); // navega para a seção após deletar
}


// ===========================================================
// ADMINISTRAÇÃO — SUSPENSÃO E DELEÇÃO DE POSTS
// ===========================================================
/*
  O admin tem poderes especiais sobre posts de outros usuários:
  - SUSPENDER: torna invisível para o público, mas mantém no banco
    (útil para remover conteúdo inadequado temporariamente)
  - RESTAURAR: desfaz a suspensão
  - DELETAR: remove permanentemente do banco

  POR QUE suspender em vez de deletar direto?
  → Dá a chance ao autor de editar e corrigir o post antes de
    ser removido definitivamente. Mais justo e reversível.

  post.suspended = true/false → campo booleano adicionado ao objeto do post.
  POR QUE não usar um array separado de "posts suspensos"?
  → Mais simples: o campo fica no próprio post, junto com todas as
    outras informações dele. Fácil de verificar: if (post.suspended).
*/
function suspendPost(postId, event) {
  if (event) event.stopPropagation(); // evita propagar clique para o card
  if (!App.currentUser?.isAdmin) return; // apenas admin pode suspender

  const posts = getPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return;

  if (!confirm(`Suspender "${post.title}"?\n\nO post ficará oculto para todos os usuários.`)) return;

  post.suspended = true;
  savePosts(posts);
  showToast('Post suspenso. Visível apenas para o administrador.', 'info');
  renderPage(post.type);
  renderHome();
}

function unsuspendPost(postId, event) {
  if (event) event.stopPropagation();
  if (!App.currentUser?.isAdmin) return;

  const posts = getPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return;

  post.suspended = false; // restaura o post
  savePosts(posts);
  showToast('Post restaurado com sucesso!', 'success');
  renderPage(post.type);
  renderHome();

  // Se a página de detalhe ainda estiver aberta, atualiza ela também
  const detailPage = document.getElementById('page-detail');
  if (detailPage && detailPage.classList.contains('active')) renderPostDetail(post);
}

function deletePostAdmin(postId, event) {
  if (event) event.stopPropagation();
  if (!App.currentUser?.isAdmin) return;

  const posts = getPosts();
  const post  = posts.find(p => p.id === postId);
  if (!post) return;

  if (!confirm(`Apagar permanentemente "${post.title}"?\n\nEsta ação não pode ser desfeita.`)) return;

  savePosts(posts.filter(p => p.id !== postId));
  showToast('Post apagado permanentemente.', 'info');
  renderPage(post.type);
  renderHome();

  // Se estava na página de detalhe do post deletado, volta para a seção
  const detailPage = document.getElementById('page-detail');
  if (detailPage && detailPage.classList.contains('active')) showPage(post.type);
}


// ===========================================================
// PÁGINA DE DETALHE DO POST
// ===========================================================
/*
  A página de detalhe mostra o post completo com todas as seções,
  imagens e vídeo. Tem uma sidebar de navegação entre seções.

  showPostDetail() → verifica permissões e abre a página
  renderPostDetail() → gera o HTML da página de detalhe

  POR QUE duas funções separadas?
  → showPostDetail() é a porta de entrada com verificações de segurança.
    renderPostDetail() apenas renderiza — pode ser chamada diretamente
    quando precisamos re-renderizar sem verificar permissão de novo
    (ex: após suspender/restaurar um post enquanto o detalhe está aberto).
*/
// ===========================================================
// FORMATAÇÃO DO TEXTO DAS SEÇÕES (redesenho 24/10/2026)
// ===========================================================
/*
  O autor escreve texto simples no editor. Esta função transforma
  alguns padrões comuns em visual de "ficha de build", sem o autor
  precisar aprender nenhuma marcação:

    Força: 50            → vira uma tabela de atributos
    Vitalidade: 30          (2 ou mais linhas seguidas "Nome: valor")

    1. Chuva de Flechas  → vira lista numerada (ordem de habilidades)
    - Anel de Fogo       → vira lista com marcadores

  Linha em branco separa parágrafos. Todo texto passa por escapeHtml
  ANTES de virar HTML, então ninguém consegue injetar código.
*/
function formatSectionContent(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const kindOf = line => {
    const t = line.trim();
    if (!t) return 'blank';
    if (/^\d+[.)]\s+/.test(t)) return 'ol';
    if (/^[-•*]\s+/.test(t)) return 'ul';
    if (/^[^:]{1,32}:\s+\S/.test(t) && !/https?:/.test(t.split(':')[0])) return 'kv';
    return 'p';
  };

  // Agrupa linhas seguidas do mesmo tipo
  const groups = [];
  lines.forEach(line => {
    const k = kindOf(line);
    const last = groups[groups.length - 1];
    if (last && last.kind === k && k !== 'blank') last.lines.push(line.trim());
    else groups.push({ kind: k, lines: [line.trim()] });
  });

  return groups.map(g => {
    if (g.kind === 'blank') return '';
    if (g.kind === 'kv' && g.lines.length >= 2) {
      return `<dl class="stat-table">${g.lines.map(l => {
        const idx = l.indexOf(':');
        return `<div><dt>${escapeHtml(l.slice(0, idx).trim())}</dt><dd>${escapeHtml(l.slice(idx + 1).trim())}</dd></div>`;
      }).join('')}</dl>`;
    }
    if (g.kind === 'ol') {
      return `<ol>${g.lines.map(l => `<li>${escapeHtml(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    if (g.kind === 'ul') {
      return `<ul>${g.lines.map(l => `<li>${escapeHtml(l.replace(/^[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${g.lines.map(escapeHtml).join('<br>')}</p>`;
  }).join('');
}

/*
  Quando um post não tem imagem de capa, mostramos a primeira letra
  do título num bloco de cor (como um brasão), em vez de um emoji.
  A cor vem da primeira tag (PVE azul, PVP vermelho...).
*/
function postMonogram(post, extraClass = '') {
  const letter = (String(post.title || '?').match(/[A-Za-zÀ-ÿ0-9]/) || ['?'])[0].toUpperCase();
  const tag = (post.tags && post.tags[0] ? post.tags[0] : post.type || '')
    .toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  return `<span class="monogram mono-${tag} ${extraClass}" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

function showPostDetail(postId) {
  const post    = getPosts().find(p => p.id === postId);
  if (!post) return;

  const isOwner = App.currentUser?.id === post.authorId;

  // Posts suspensos: apenas admin e o próprio autor podem ver
  if (post.suspended && !App.currentUser?.isAdmin && !isOwner) {
    showToast('Este post não está disponível.', 'info');
    return;
  }

  App.currentDetailPostId = postId; // guarda qual post está aberto
  renderPostDetail(post);
  showPage('detail');
}

/*
  Gera o HTML completo da página de detalhe de um post.

  ESTRUTURA DA PÁGINA:
  ┌─────────────────────────────────────┐
  │ ← Voltar para Builds               │ ← botão de voltar
  │ [banner de suspensão se aplicável] │
  │ 🏹 Título do Post                   │ ← hero com emoji, título, meta
  │ ┌──────────┬──────────────────────┐ │
  │ │ Sidebar  │  Seção 1             │ │ ← layout de 2 colunas
  │ │ • Sec 1  │  Seção 2             │ │
  │ │ • Sec 2  │  ▶ Vídeo             │ │
  │ └──────────┴──────────────────────┘ │
  └─────────────────────────────────────┘

  flatMap() → une arrays de imagens de todas as seções em uma lista única.
  Isso permite ao lightbox navegar entre todas as imagens do post.
*/
function renderPostDetail(post) {
  const page = document.getElementById('page-detail');

  // ── MODO DE EDIÇÃO INLINE ──────────────────────────────────────
  /*
    Quando App.inlineEditing está ativo, renderiza o editor diretamente
    na página de detalhe em vez de abrir um modal separado.

    O layout replica a estrutura visual do post (hero + seções) mas
    substitui os elementos estáticos por campos editáveis — o admin
    vê exatamente onde cada parte do post vai aparecer.
  */
  if (App.inlineEditing && App.editingPostId === post.id) {
    /*
      MODO WYSIWYG: o post é renderizado com a mesma estrutura visual do leitor,
      mas com contenteditable nos textos e drag-and-drop nas imagens.
      O admin clica diretamente no título, descrição ou seção para editar —
      sem campos de formulário separados.
    */
    // true = criar novo post; false = editar post existente
    const isCreating = !post.id;
    // Builds e Guias têm seções e YouTube; Novidades não
    const isExtended = post.type === 'builds' || post.type === 'guias';

    const tagsRowHtml = TAG_OPTIONS[post.type].map(tag => {
      const active = App.selectedTags.includes(tag);
      return `<button class="filter-btn${active ? ' active' : ''}"
        style="border-radius:4px;font-size:.68rem"
        onclick="togglePostTag('${tag}',this)">${tag}</button>`;
    }).join('');

    page.innerHTML = `
      <!-- Barra sticky: sempre visível ao rolar, controles mínimos -->
      <div class="ie-toolbar">
        <span class="ie-toolbar-label">
          ${isCreating ? '✍️ Novo post' : '✏️ Editando'} — clique em qualquer texto para editar
        </span>
        <div class="ie-toolbar-btns">
          <button class="btn btn-outline" style="font-size:.78rem;padding:.3rem .8rem"
            onclick="ieToggleSettings()">⚙️ Config</button>
          <button class="btn btn-outline" style="font-size:.78rem;padding:.3rem .8rem"
            onclick="cancelInlineEdit()">Descartar</button>
          <button class="btn btn-primary" style="font-size:.78rem;padding:.3rem .8rem"
            onclick="saveInlineEdit()">${isCreating ? '🐉 Publicar' : '💾 Salvar'}</button>
        </div>
      </div>

      <!--
        Painel de configurações: oculto até clicar em ⚙️ Config.
        Tags, capa e YouTube ficam aqui — fora do corpo do documento.
        POR QUE separar do documento?
        → Em editores como Word e Notion, metadados ficam em painéis
          separados, não embutidos no texto visível.
      -->
      <div class="ie-settings-panel" id="ie-settings-panel">
        <div class="ie-settings-group">
          <span class="ie-field-label">Tags</span>
          <div style="display:flex;gap:.35rem;flex-wrap:wrap">${tagsRowHtml}</div>
        </div>
        <div class="ie-settings-group">
          <span class="ie-field-label">Imagem de capa</span>
          <div class="ie-cover-area" style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
            ${App.postCardImage ? `
              <img src="${App.postCardImage}" class="ie-cover-thumb" alt="capa">
              <button class="ie-small-btn" onclick="ieRemoveCover()">✕ Remover</button>` : ''}
            <label class="ie-small-btn" style="cursor:pointer">
              🖼️ ${App.postCardImage ? 'Trocar' : 'Adicionar capa'}
              <input type="file" accept="image/*" style="display:none" onchange="ieUploadCover(event)">
            </label>
          </div>
        </div>
        ${isExtended ? `
        <div class="ie-settings-group">
          <span class="ie-field-label">YouTube URL</span>
          <input class="ie-yt-input" id="ie-youtube" type="text"
            value="${escapeHtml(post.youtubeUrl || '')}"
            placeholder="https://youtube.com/watch?v=...">
        </div>` : ''}
      </div>

      <!-- Botão voltar / descartar -->
      <button class="detail-back" onclick="cancelInlineEdit()">
        ← ${isCreating ? 'Descartar' : 'Cancelar edição'}
      </button>

      <!-- Hero: mesma estrutura do post publicado, mas com contenteditable -->
      <div class="detail-hero">
        <!-- Emoji: clique para trocar diretamente -->
        <span class="ie-emoji-ce" id="ie-emoji" contenteditable="true"
          spellcheck="false">${escapeHtml(post.emoji)}</span>

        <div class="detail-hero-info">
          <!-- Título: mesma fonte Cinzel e tamanho do post publicado -->
          <div class="detail-title ie-ce" id="ie-title"
            contenteditable="true" spellcheck="true"
            data-placeholder="Título do post...">${escapeHtml(post.title)}</div>

          <!-- Autor e data: gerados automaticamente, não editáveis -->
          <div class="detail-meta" style="margin-bottom:.5rem">
            <div class="detail-author">
              <div class="detail-author-avatar">${post.author[0].toUpperCase()}</div>
              ${escapeHtml(post.author)}
            </div>
            <span class="detail-date">${post.date}</span>
          </div>

          <!-- Resumo: mesma tipografia Crimson Pro do card -->
          <p class="ie-ce" id="ie-desc" contenteditable="true" spellcheck="true"
            data-placeholder="Escreva um resumo do post..."
            style="font-family:var(--font-text);font-size:1rem;
                   color:var(--text-secondary);margin:0 0 .65rem"
          >${escapeHtml(post.desc)}</p>
        </div>
      </div>

      <!-- Seções: apenas para Builds e Guias (Novidades não têm seções) -->
      ${isExtended ? `
      <div class="detail-layout">
        <main class="detail-main">
          <div id="ie-sections-container">${ieRenderSections()}</div>
          <button class="ie-add-sec-btn" onclick="ieAddSection()">+ Adicionar seção</button>
        </main>
      </div>` : ''}

      <!-- Botões de salvar ao final da página (evita rolar de volta ao topo) -->
      <div class="ie-save-bottom">
        <button class="btn btn-outline" onclick="cancelInlineEdit()">Descartar</button>
        <button class="btn btn-primary" onclick="saveInlineEdit()">
          ${isCreating ? '🐉 Publicar Post' : '💾 Salvar Alterações'}
        </button>
      </div>
    `;

    ieAttachListeners(); // registra oninput nos contenteditable para manter App.postSections sincronizado
    return;
  }
  // ── FIM DO MODO DE EDIÇÃO ──────────────────────────────────────

  const isAdmin   = App.currentUser?.isAdmin;
  const isOwner   = App.currentUser && App.currentUser.id === post.authorId;
  const suspended = post.suspended === true;
  const sections  = post.sections || [];
  const videoId   = extractYouTubeId(post.youtubeUrl);

  // Monta lista flat de todas as imagens de todas as seções para o lightbox
  App._detailImages = sections.flatMap(s => s.images || []);

  // Gera botões de navegação da sidebar (um por seção)
  const sidebarItems = sections.map(s =>
    `<button class="detail-nav-item" onclick="scrollToSection('${s.id}')">${escapeHtml(s.name || 'Seção')}</button>`
  ).join('');

  // Botão de vídeo na sidebar só aparece se há vídeo
  const videoNavItem = videoId
    ? `<button class="detail-nav-item" onclick="scrollToSection('detail-video')">Vídeo</button>` : '';

  const hasSidebar = sections.length > 0 || videoId; // sidebar só aparece se há algo para navegar

  // Renderiza as seções com suas imagens embutidas
  let imgOffset = 0; // offset acumulado para o índice do lightbox
  const sectionsHtml = sections.map(s => {
    const sImgs = s.images || [];
    // A classe "n-1", "n-2"... deixa o CSS escolher o layout:
    // 1 imagem ocupa a largura toda; 2 ou mais viram uma grade.
    const secImgHtml = sImgs.length > 0 ? `
      <div class="images-grid n-${Math.min(sImgs.length, 3)}">
        ${sImgs.map((_, j) => `<img src="${sImgs[j]}" alt="${escapeHtml(s.name || 'Imagem')} ${j+1}" loading="lazy" onclick="openLightbox(${imgOffset + j})" />`).join('')}
      </div>` : '';
    imgOffset += sImgs.length; // avança o offset para as próximas seções
    return `
      <div class="detail-section" id="${s.id}">
        <h2 class="detail-section-title">${escapeHtml(s.name || 'Seção')}</h2>
        <div class="detail-section-content rich">${formatSectionContent(s.content)}</div>
        ${secImgHtml}
      </div>`;
  }).join('');

  // Compatibilidade com posts antigos que tinham imagens no nível do post (não nas seções)
  const legacyImgs = (post.images || []);
  if (legacyImgs.length > 0) App._detailImages = [...App._detailImages, ...legacyImgs];
  const imagesHtml = ''; // imagens antigas já ficam nas seções

  /*
    Bloco de vídeo YouTube.

    REGRA:
    - youtubeEmbeddable === false → bloqueado confirmado → exibe link de texto
    - qualquer outro valor        → tenta o player via YouTube IFrame API oficial
                                    que dispara onError real se o vídeo bloquear embed
                                    → ao erro, troca para link e salva flag no localStorage

    POR QUE YOUTUBE IFRAME API E NÃO <iframe> DIRETO?
    O <iframe> simples não expõe eventos de erro para a página pai (cross-origin).
    A YouTube IFrame API carrega uma biblioteca JS do YouTube que gerencia
    a comunicação e dispara eventos reais — inclusive onError com código 153.
    Isso detecta TODOS os tipos de bloqueio, inclusive restrições de domínio
    e licenciamento que a API oEmbed não consegue identificar.
  */
  const ytUrl      = `https://www.youtube.com/watch?v=${videoId}`;
  const youtubeHtml = videoId ? `
    <div class="detail-section" id="detail-video">
      <h2 class="detail-section-title">Vídeo</h2>
      ${post.youtubeEmbeddable === false
        ? /* link simples para vídeos confirmados como bloqueados */
          `<a href="${ytUrl}" target="_blank" rel="noopener noreferrer" class="yt-link">
            ▶ Assistir no YouTube
          </a>`
        : /* container para a YouTube IFrame API — o <iframe> é criado pela API */
          `<div class="youtube-wrapper" id="yt-wrapper-${videoId}">
            <div id="yt-player-${videoId}"></div>
          </div>`
      }
    </div>
  ` : '';

  // Tags coloridas
  const tagsHtml = post.tags.map(t =>
    `<span class="tag tag-${t.toLowerCase().replace(/[^a-z]/g,'')}">${t}</span>`
  ).join('');

  // Botão de editar (aparece para dono e admin de novidades)
  const canEdit = isOwner || (isAdmin && post.type === 'novidades');
  const editBtn = canEdit
    ? `<button class="btn-edit" onclick="startInlineEdit('${post.id}')" title="Editar post">Editar</button>` : '';

  /*
    Botão(ões) de ação administrativa na página de detalhe.
    A lógica varia bastante dependendo de quem está vendo e do estado do post:
    - Admin vendo post suspenso: pode Restaurar ou Apagar
    - Admin vendo novidade (não suspensa): pode Deletar
    - Admin vendo build/guia de outro usuário: pode Suspender
    - Dono do post (qualquer tipo): pode Deletar
  */
  let deleteBtn = '';
  if (isAdmin && !isOwner) {
    if (suspended) {
      deleteBtn = `
        <button class="btn btn-outline" style="font-size:.72rem;padding:.32rem .65rem;border-color:rgba(82,183,136,.3);color:var(--green)"
          onclick="unsuspendPost('${post.id}')">Restaurar</button>
        <button class="btn btn-outline" style="font-size:.72rem;padding:.32rem .65rem;border-color:rgba(200,0,30,.3);color:var(--red)"
          onclick="deletePostAdmin('${post.id}')">Apagar</button>
      `;
    } else if (post.type === 'novidades') {
      deleteBtn = `
        <button class="btn btn-outline" style="font-size:.72rem;padding:.32rem .65rem;border-color:rgba(200,0,30,.3);color:var(--red)"
          onclick="deletePostAdmin('${post.id}')">Deletar</button>
      `;
    } else {
      deleteBtn = `
        <button class="btn btn-outline" style="font-size:.72rem;padding:.32rem .65rem;border-color:rgba(201,168,76,.3);color:var(--gold)"
          onclick="suspendPost('${post.id}')">Suspender</button>
      `;
    }
  } else if (isOwner) {
    deleteBtn = `
      <button class="btn btn-outline" style="font-size:.72rem;padding:.32rem .65rem;border-color:rgba(200,0,30,.3);color:var(--red)"
        onclick="deletePostFromDetail('${post.id}','${post.type}')">Deletar</button>
    `;
  }

  // Banner de aviso de suspensão (admin vê aviso de controle, dono vê aviso de advertência)
  let suspendedBanner = '';
  if (suspended && isAdmin) {
    suspendedBanner = `
      <div class="detail-suspended-banner">
        🚫 Este post está <strong>suspenso</strong> — invisível para outros usuários.
        <button onclick="unsuspendPost('${post.id}')">Restaurar</button>
      </div>`;
  } else if (suspended && isOwner) {
    suspendedBanner = `
      <div class="detail-suspended-banner" style="border-color:rgba(201,168,76,.35);background:rgba(201,168,76,.08);color:var(--gold)">
        ⚠️ Seu post foi <strong>suspenso</strong> pelo administrador. Edite-o para adequar às políticas do site.
        <button onclick="startInlineEdit('${post.id}')" style="border-color:rgba(201,168,76,.4);color:var(--gold)">✏️ Editar</button>
      </div>`;
  }

  /*
    imageNavItem: reservado para futura navegação de galeria na sidebar.
    Declarado vazio para não causar ReferenceError no template literal abaixo.
    POR QUE declarar como string vazia?
    → O template literal abaixo usa ${imageNavItem}. Sem declaração,
      o JavaScript lançaria "imageNavItem is not defined".
  */
  const imageNavItem = '';

  // backLabel: texto do botão de voltar, conforme o tipo do post
  const backLabel = { builds: 'Builds', guias: 'Guias', novidades: 'Notícias' }[post.type] || 'Posts';

  // Monta o HTML completo da página
  /*
    REDESENHO (24/10/2026) — inspirado em Maxroll e Mobalytics:
    - a capa do post vira um banner largo no topo (se existir);
    - o vídeo vem ANTES das seções, porque numa build o vídeo é a prova
      de que ela funciona (é o que o leitor mais quer ver primeiro);
    - nada de emoji como ícone: o banner ou o título fazem esse papel.
  */
  const cover = post.cardImage
    ? `<div class="bp-cover"><img src="${escapeHtml(post.cardImage)}" alt=""></div>` : '';

  page.innerHTML = `
    <div class="bp ${post.cardImage ? 'has-cover' : ''}">
      ${cover}
      <div class="bp-top">
        <button class="detail-back" onclick="showPage('${post.type}')">← ${backLabel}</button>
        ${suspendedBanner}
        <header class="detail-hero">
          <div class="detail-hero-info">
            <div class="detail-tags">${tagsHtml}</div>
            <h1 class="detail-title">${escapeHtml(post.title)}</h1>
            <p class="detail-summary">${escapeHtml(post.desc)}</p>
            <div class="detail-meta">
              <div class="detail-author clickable-author"
                   onclick="showProfile('${post.authorId}')"
                   title="Ver perfil de ${escapeHtml(post.author)}">
                <div class="detail-author-avatar">${escapeHtml(post.author[0].toUpperCase())}</div>
                ${escapeHtml(post.author)}
              </div>
              <span class="detail-date">${post.date}</span>
            </div>
          </div>
          <div class="detail-hero-actions">${editBtn}${deleteBtn}</div>
        </header>
      </div>

      <div class="detail-layout">
        ${hasSidebar ? `
        <aside class="detail-sidebar">
          <div class="detail-sidebar-title">Nesta página</div>
          ${videoNavItem}${sidebarItems}${imageNavItem}
        </aside>` : ''}
        <main class="detail-main">
          ${youtubeHtml}${sectionsHtml}${imagesHtml}
          ${!sectionsHtml && !imagesHtml && !youtubeHtml ? `
            <p class="detail-empty">Este post ainda não tem conteúdo detalhado.</p>` : ''}
        </main>
      </div>
    </div>
  `;

  // Inicializa o player YouTube via API oficial (detecta onError real)
  if (videoId && post.youtubeEmbeddable !== false) {
    initYouTubePlayer(videoId, post.id);
  }
}

// ===========================================================
// PLAYER YOUTUBE VIA IFRAME API OFICIAL
// ===========================================================
/*
  Em vez de criar um <iframe> diretamente no HTML, usamos a YouTube IFrame
  Player API — uma biblioteca JS do próprio YouTube que cria o iframe e
  gerencia a comunicação via postMessage de forma interna e confiável.

  VANTAGEM SOBRE <iframe> DIRETO:
  O <iframe> simples é cross-origin: a página pai não consegue ler seu
  conteúdo nem receber eventos de erro. Com a YouTube IFrame API, o
  YouTube registra um canal de comunicação e dispara eventos reais como
  onError, onReady e onStateChange — acessíveis pela página pai.

  ISSO DETECTA TODOS OS TIPOS DE BLOQUEIO:
  - Embedding desabilitado pelo dono (toggle no YouTube Studio)
  - Restrições de domínio (só embeds no próprio site do dono)
  - Licenciamento e restrições de conteúdo
  - Qualquer cenário que produza Erro 153, 150 ou 101

  CARREGAMENTO LAZY:
  O script da API (youtube.com/iframe_api) só é carregado quando um post
  com vídeo é aberto — não no carregamento inicial da página. Isso evita
  carregar ~1KB de script desnecessário para quem não vê vídeos.
*/

// Carrega o script da YouTube IFrame API uma única vez
function loadYouTubeIframeAPI() {
  return new Promise((resolve) => {
    // API já carregada em uma visita anterior nessa sessão
    if (window.YT && window.YT.Player) { resolve(); return; }

    // Encadeia com um possível callback já existente para não sobrescrever
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };

    // Só adiciona o script se ainda não estiver no DOM
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s  = document.createElement('script');
      s.src    = 'https://www.youtube.com/iframe_api';
      s.async  = true;
      document.head.appendChild(s);
    }
  });
}

/*
  Inicializa o player YouTube para um post. Carrega a API se necessário,
  cria o player dentro do elemento #yt-player-VIDEOID e aguarda eventos.

  Se onError disparar com código 101, 150 ou 153 (embed bloqueado):
  1. Substitui o wrapper do player por um link de texto simples
  2. Salva youtubeEmbeddable: false no localStorage (próxima visita já sabe)
*/
async function initYouTubePlayer(videoId, postId) {
  try {
    await loadYouTubeIframeAPI();

    const containerId = `yt-player-${videoId}`;
    if (!document.getElementById(containerId)) return; // usuário navegou para outro lugar

    new YT.Player(containerId, {
      videoId,
      playerVars: {
        autoplay: 0, // não inicia automaticamente
        rel:      0, // não mostra vídeos relacionados ao fim
      },
      events: {
        onError: (event) => {
          // Códigos de bloqueio de embed: 101 = desabilitado, 150 = idem (HTML5), 153 = configuração
          if (![101, 150, 153].includes(event.data)) return;

          /*
            Troca o wrapper do player por um link simples APENAS VISUALMENTE.
            NÃO salva no localStorage, pois o Erro 153 pode ser causado por
            restrição de domínio — o vídeo só embeds no domínio do dono, não
            em localhost ou outros domínios. Em produção (no domínio correto),
            o embed funcionaria normalmente.
            Salvar "false" aqui causaria um loop: o usuário re-verifica no
            formulário (oEmbed retorna 200 = embeddable), salva "true", abre o
            post → IFrame API dispara 153 no localhost → salva "false" de novo.
            O oEmbed no formulário é o único árbitro permanente do flag.
          */
          const wrapper = document.getElementById(`yt-wrapper-${videoId}`);
          if (wrapper) {
            const link    = document.createElement('a');
            link.href     = `https://www.youtube.com/watch?v=${videoId}`;
            link.target   = '_blank';
            link.rel      = 'noopener noreferrer';
            link.className = 'yt-link';
            link.textContent = '▶ Assistir no YouTube';
            wrapper.replaceWith(link);
          }
        },
      },
    });

  } catch {
    // Falha ao carregar a API (sem internet) — não há o que fazer
  }
}


/*
  Rola a tela suavemente até uma seção específica.
  Também destaca o item correspondente na sidebar.

  scrollIntoView({ behavior: 'smooth' }) → animação suave nativa do browser.
  POR QUE não usar window.scrollTo()?
  → scrollIntoView calcula automaticamente a posição do elemento,
    sem precisar medir manualmente com offsetTop.
*/
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Destaca o botão da sidebar correspondente à seção atual
  document.querySelectorAll('.detail-nav-item').forEach(btn => {
    const attr = btn.getAttribute('onclick') || '';
    btn.classList.toggle('active', attr.includes(`'${id}'`));
  });
}

/*
  Abre o lightbox (visualizador de imagem em tela cheia).
  Cria dinamicamente os elementos de overlay, botão de fechar e imagem.

  POR QUE criar o elemento dinamicamente em vez de ter um div fixo no HTML?
  → Mais limpo: quando o lightbox fecha, o elemento é removido do DOM completamente.
    Com div fixo, precisaríamos gerenciar show/hide e limpar o src ao fechar.

  lb.onclick = () => lb.remove() → clique no fundo escuro fecha o lightbox
  img.onclick = e => e.stopPropagation() → clique na imagem NÃO fecha o lightbox
*/
function openLightbox(index) {
  const src = App._detailImages[index];
  if (!src) return;

  const lb = document.createElement('div');
  lb.className = 'lightbox-backdrop';
  lb.onclick   = () => lb.remove(); // fecha ao clicar fora da imagem

  const close = document.createElement('span');
  close.className   = 'lightbox-close';
  close.textContent = '✕';
  close.onclick = e => { e.stopPropagation(); lb.remove(); }; // fecha ao clicar no X

  const img   = document.createElement('img');
  img.src     = src;
  img.alt     = 'imagem ampliada';
  img.onclick = e => e.stopPropagation(); // evita fechar ao clicar na imagem

  lb.appendChild(close);
  lb.appendChild(img);
  document.body.appendChild(lb); // adiciona ao body para ficar sobre tudo
}


// ===========================================================
// RENDERIZAÇÃO — HOME
// ===========================================================
/*
  A home exibe as 3 últimas novidades, builds e guias.
  POR QUE apenas 3?
  → A home é uma vitrine. Mostrar muito conteúdo deixaria pesado e confuso.
    Para ver mais, o usuário navega para a seção específica.

  visible(p) → função que decide se um post deve aparecer:
  - Posts normais: sempre visíveis
  - Posts suspensos: só visíveis para admin ou para o próprio autor
*/
function renderHome() {
  const uid     = App.currentUser?.id;
  const isAdmin = App.currentUser?.isAdmin;
  const visible = p => !p.suspended || isAdmin || p.authorId === uid;

  renderHomeNews(getPostsByType('novidades').filter(visible).slice(0, 3));
  renderHomeBuilds(getPostsByType('builds').filter(visible).slice(0, 3));
  renderHomeGuides(getPostsByType('guias').filter(visible).slice(0, 3));
}

/*
  Renderiza os cards de novidades na home.
  Cada card clicável abre a página de detalhe do post.

  .replace() nas tags: remove acentos para criar nomes de classes CSS válidos
  (ex: 'ATUALIZAÇÃO' → 'atualizacao' para a classe CSS tag-atualizacao)
*/
function renderHomeNews(posts) {
  const c = document.getElementById('homeNewsList');
  if (!c) return;
  if (posts.length === 0) {
    c.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Nenhuma novidade ainda.</p>';
    return;
  }
  c.innerHTML = posts.map(p => `
    <div class="news-card" onclick="showPostDetail('${p.id}')" style="cursor:pointer">
      <div class="news-thumb">
        ${p.cardImage
          /* se o post tem imagem de capa, mostra ela no lugar do emoji */
          ? `<img class="home-card-img" src="${escapeHtml(p.cardImage)}" alt="${escapeHtml(p.title)}">`
          : postMonogram(p)}
      </div>
      <div class="news-info">
        ${p.tags.map(t => `<span class="tag tag-${t.toLowerCase().replace('ç','c').replace('ã','a').replace('ó','o')}">${t}</span>`).join(' ')}
        <div class="news-title">${escapeHtml(p.title)}</div>
        <div class="news-desc">${escapeHtml(p.desc)}</div>
        <div class="news-date">${p.date}</div>
      </div>
    </div>
  `).join('');
}

/* Renderiza os cards de builds na home */
function renderHomeBuilds(posts) {
  const c = document.getElementById('homeBuildsList');
  if (!c) return;
  if (posts.length === 0) {
    c.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Nenhuma build ainda.</p>';
    return;
  }
  c.innerHTML = posts.map(p => `
    <div class="build-card" onclick="showPostDetail('${p.id}')" style="cursor:pointer">
      <div class="build-icon">
        ${p.cardImage
          ? `<img class="home-card-img" src="${escapeHtml(p.cardImage)}" alt="${escapeHtml(p.title)}">`
          : postMonogram(p)}
      </div>
      <div class="build-info">
        <div class="build-name">${escapeHtml(p.title)}</div>
        <div class="build-tags">
          ${p.tags.map(t => `<span class="tag tag-${t.toLowerCase()}">${t}</span>`).join('')}
        </div>
      </div>
      <div class="build-arrow">›</div>
    </div>
  `).join('');
}

/* Renderiza os cards de guias na home */
function renderHomeGuides(posts) {
  const c = document.getElementById('homeGuidesList');
  if (!c) return;
  if (posts.length === 0) {
    c.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Nenhum guia ainda.</p>';
    return;
  }
  c.innerHTML = posts.map(p => `
    <div class="guide-card" onclick="showPostDetail('${p.id}')" style="cursor:pointer">
      <div class="guide-icon">
        ${p.cardImage
          ? `<img class="home-card-img" src="${escapeHtml(p.cardImage)}" alt="${escapeHtml(p.title)}">`
          : postMonogram(p)}
      </div>
      <div class="guide-info">
        <div class="guide-name">${escapeHtml(p.title)}</div>
        <!-- substring(0, 60) limita a descrição a 60 caracteres para o card não ficar muito alto -->
        <div class="guide-desc">${escapeHtml(p.desc)}</div>
      </div>
      <div class="build-arrow" style="color:var(--gold)">›</div>
    </div>
  `).join('');
}


// ===========================================================
// RENDERIZAÇÃO — PÁGINAS INTERNAS (Novidades, Builds, Guias)
// ===========================================================
/*
  Renderiza a grade de posts de uma seção específica.

  PASSO A PASSO:
  1. Identifica o elemento da grade no HTML pelo tipo
  2. Busca todos os posts do tipo
  3. Filtra posts suspensos (invisíveis para usuários normais)
  4. Aplica o filtro de tag ativo (ex: mostrar só PVE)
  5. Ordena por data (mais recentes primeiro)
  6. Exibe estado vazio ou a grade de cards

  posts.sort((a, b) => b.timestamp - a.timestamp)
  → Ordena em ordem decrescente de timestamp.
    Se b.timestamp > a.timestamp, b vem antes de a (mais recente primeiro).
*/
function renderPage(type) {
  const gridId = { novidades: 'novidadesGrid', builds: 'buildsGrid', guias: 'guiasGrid' }[type];
  const grid   = document.getElementById(gridId);
  if (!grid) return;

  let posts = getPostsByType(type);
  const uid = App.currentUser?.id;

  // Remove posts suspensos para usuários não-admin (exceto o próprio autor)
  if (!App.currentUser?.isAdmin) posts = posts.filter(p => !p.suspended || p.authorId === uid);

  // Aplica filtro de tag (se 'all', mostra todos)
  const f = App.currentFilter[type];
  if (f && f !== 'all') posts = posts.filter(p => p.tags.includes(f));

  /*
    Aplica o filtro de busca quando há um termo ativo.
    Compara o texto digitado (já normalizado) com título, descrição e tags
    de cada post (também normalizados), para que:
    — "furia"    encontre "Fúria do Dragão"
    — "masmorra" encontre "Masmorra" e "MASMORRA"
    — "pvp"      encontre posts com a tag "PVP"
  */
  if (App.searchQuery) {
    const q = App.searchQuery;
    posts = posts.filter(p =>
      normalize(p.title).includes(q) ||
      normalize(p.desc).includes(q)  ||
      p.tags.some(t => normalize(t).includes(q))
    );
  }

  // Ordena mais recentes primeiro
  posts.sort((a, b) => b.timestamp - a.timestamp);

  if (posts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-title">Nenhum post encontrado</div>
        <p>${App.currentUser ? 'Seja o primeiro a publicar nesta seção!' : 'Faça login e seja o primeiro a publicar aqui!'}</p>
        ${App.currentUser
          ? `<button class="btn btn-primary" style="margin:1rem auto;display:flex" onclick="openNewPostModal('${type}')">+ Criar Post</button>`
          : `<button class="btn btn-outline"  style="margin:1rem auto;display:flex" onclick="openAuthModal()">Entrar</button>`}
      </div>`;
    // Limpa a barra de paginação quando não há posts
    const pagEl = document.getElementById(type + 'Pagination');
    if (pagEl) pagEl.innerHTML = '';
    return;
  }

  /*
    PAGINAÇÃO: fatiamento dos posts
    Em vez de renderizar todos os posts de uma vez, exibimos apenas
    a "fatia" correspondente à página atual.

    Exemplo com perPage=12 e 47 posts:
    — Página 1: posts[0..11]   (índices 0 a 11)
    — Página 2: posts[12..23]  (índices 12 a 23)
    — Página 4: posts[36..46]  (índices 36 a 46, somente 11 posts)

    PASSO A PASSO:
    1. Pega o estado de paginação desta seção (página atual e por-página)
    2. Calcula o total de páginas: ceil(47 ÷ 12) = 4 páginas
    3. Garante que a página atual não seja maior que o total
       (pode acontecer ao mudar filtros com menos resultados)
    4. Calcula o índice inicial: (página - 1) × perPage
    5. Fatia o array: posts.slice(início, início + perPage)
    6. Renderiza só os cards dessa fatia
    7. Atualiza a barra de paginação abaixo da grade
  */
  const pag   = App.pagination[type];
  const pages = Math.ceil(posts.length / pag.perPage);
  pag.page    = Math.max(1, Math.min(pag.page, pages)); // mantém dentro dos limites

  const start = (pag.page - 1) * pag.perPage;
  const slice = posts.slice(start, start + pag.perPage);

  grid.innerHTML = slice.map(p => buildPostCard(p)).join('');
  renderPagination(type, posts.length, pages, pag);
}

/*
  Gera o HTML de um card de post individual.

  POR QUE uma função separada em vez de inline no renderPage()?
  → buildPostCard() é reusável: usada em renderPage(), renderHome(),
    renderMyPosts(). Sem ela, precisaríamos duplicar o HTML do card.

  ESTRUTURA DO CARD:
  ┌────────────────────────────┐
  │ [botões de ação admin]     │ ← visíveis só para admin/dono
  │ [SUSPENSO]                 │ ← badge apenas em posts suspensos
  │ 🖼️ imagem ou emoji         │ ← thumbnail
  │ TAG  TAG                   │
  │ Título do Post             │
  │ Descrição resumida...      │
  │ 👤 Autor           Data   │
  └────────────────────────────┘
*/
function buildPostCard(post) {
  const isAdmin    = App.currentUser?.isAdmin;
  const isOwner    = App.currentUser && App.currentUser.id === post.authorId;
  const suspended  = post.suspended === true;
  const detailable = !suspended; // posts suspensos não abrem detalhe ao clicar

  // Posts suspensos ficam ocultos para quem não é admin nem dono
  if (suspended && !isAdmin && !isOwner) return '';

  const tagsHtml = post.tags.map(t =>
    `<span class="tag tag-${t.toLowerCase().replace(/[^a-z]/g,'')}">${t}</span>`
  ).join('');

  /*
    Botões de ação variam muito conforme a situação:
    - Admin: vê botões de suspender/restaurar/deletar
    - Dono: vê botão de deletar
    - Outros: não veem botões
  */
  let actionHtml = '';
  if (isAdmin) {
    const btns = [];
    if (suspended) {
      // Post suspenso: mostrar opções de restaurar ou apagar definitivamente
      btns.push(`<button class="post-card-action-btn btn-res" onclick="unsuspendPost('${post.id}',event)" title="Restaurar post">🔄</button>`);
      btns.push(`<button class="post-card-action-btn btn-del" onclick="deletePostAdmin('${post.id}',event)" title="Apagar permanentemente">🗑️</button>`);
    } else if (post.type === 'novidades') {
      if (post.authorId !== 'admin') {
        btns.push(`<button class="post-card-action-btn btn-sus" onclick="suspendPost('${post.id}',event)" title="Suspender post">🚫</button>`);
      }
      btns.push(`<button class="post-card-action-btn btn-del" onclick="deletePostAdmin('${post.id}',event)" title="Deletar post">✕</button>`);
    } else {
      if (isOwner) {
        btns.push(`<button class="post-card-action-btn btn-del" onclick="deletePost('${post.id}',event)" title="Deletar post">✕</button>`);
      } else {
        btns.push(`<button class="post-card-action-btn btn-sus" onclick="suspendPost('${post.id}',event)" title="Suspender post">🚫</button>`);
      }
    }
    actionHtml = `<div class="post-card-actions">${btns.join('')}</div>`;
  } else if (isOwner) {
    actionHtml = `<button class="post-card-delete" onclick="deletePost('${post.id}', event)" title="Deletar post">✕</button>`;
  }

  const suspendedBadge = suspended ? `<div class="suspended-badge">SUSPENSO</div>` : '';

  // Se detailable, o card inteiro é clicável para abrir o detalhe
  const clickAttr    = detailable ? `onclick="showPostDetail('${post.id}')" style="cursor:pointer"` : '';

  // Thumbnail: imagem de capa se existir, emoji caso contrário
  const thumbContent = post.cardImage
    ? `<img class="card-thumb-img" src="${post.cardImage}" alt="${escapeHtml(post.title)}" />`
    : postMonogram(post);

  return `
    <div class="post-card${suspended ? ' suspended' : ''}" ${clickAttr}>
      ${actionHtml}${suspendedBadge}
      <div class="post-card-thumb">${thumbContent}</div>
      <div class="post-card-body">
        <div class="post-card-tags">${tagsHtml}</div>
        <h3 class="post-card-title">${escapeHtml(post.title)}</h3>
        <p class="post-card-desc">${escapeHtml(post.desc)}</p>
        <div class="post-card-footer">
          <div class="post-card-author clickable-author"
               onclick="event.stopPropagation(); showProfile('${post.authorId}')"
               title="Ver perfil de ${escapeHtml(post.author)}">
            <div class="post-card-avatar">${post.author[0].toUpperCase()}</div>
            <span>${escapeHtml(post.author)}</span>
          </div>
          <span>${post.date}</span>
        </div>
      </div>
    </div>
  `;
}


// ===========================================================
// FILTROS DE POSTS
// ===========================================================
/*
  Filtra os posts da seção atual por tag.
  filterValue: 'all' (todos) ou uma tag específica (ex: 'PVE')

  btnEl.closest('.page-filters') → sobe na árvore do DOM até encontrar
  o container de filtros, para desativar TODOS os outros botões antes de
  ativar o clicado. Sem isso, vários filtros ficariam ativos ao mesmo tempo.
*/
function filterPosts(type, filterValue, btnEl) {
  App.currentFilter[type]    = filterValue; // guarda o filtro ativo para este tipo
  App.pagination[type].page  = 1;           // volta à página 1 ao mudar o filtro
  btnEl.closest('.page-filters').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active'); // destaca apenas o botão clicado
  renderPage(type); // re-renderiza a grade com o novo filtro
}


// ===========================================================
// BUSCA
// ===========================================================
/*
  Busca posts por texto em tempo real, insensível a maiúsculas E a acentos.
  "furia do dragao" encontra "Fúria do Dragão"; "masmorra" encontra "Masmorra".

  PASSO A PASSO:
  1. Lê o texto do campo e normaliza (remove acentos, converte para minúsculas)
  2. Se o campo estiver vazio ou com menos de 2 letras:
     → Limpa a busca e re-exibe todos os posts normalmente
  3. Salva o termo normalizado em App.searchQuery
  4. Conta quantos posts combinam em cada seção (novidades, builds, guias)
  5. Navega para a seção com mais resultados
     (renderPage() vai filtrar automaticamente usando App.searchQuery)
  6. Exibe o número total de resultados encontrados

  COMO OS POSTS SÃO FILTRADOS?
  Não é handleSearch() que filtra — é renderPage().
  handleSearch() apenas define App.searchQuery e navega.
  renderPage() lê App.searchQuery e exibe só os posts que correspondem.
  Isso garante que, se o usuário mudar de página enquanto a busca está ativa,
  a nova página também mostrará só os posts relevantes.

  POR QUE mínimo de 2 caracteres?
  → Uma letra só geraria resultados demais (pouco útil).
    "a" corresponderia a quase tudo. Dois já permitem buscas úteis.
*/
function handleSearch() {
  const raw   = document.getElementById('searchInput').value.trim();
  const query = normalize(raw); // normaliza: remove acentos + minúsculas

  // Campo vazio ou muito curto → sai do modo de busca
  if (query.length < 2) {
    if (App.searchQuery) {
      // Só re-renderiza se havia uma busca ativa (evita trabalho desnecessário)
      App.searchQuery = '';
      Object.keys(App.pagination).forEach(t => { App.pagination[t].page = 1; });
      renderPage('novidades');
      renderPage('builds');
      renderPage('guias');
    }
    return;
  }

  // Salva o termo normalizado para que renderPage() o use no filtro
  App.searchQuery = query;

  // Volta todas as seções para a página 1 — os resultados mudam completamente
  Object.keys(App.pagination).forEach(t => { App.pagination[t].page = 1; });

  // Conta quantos posts correspondem em cada seção
  // (respeita suspensão: posts suspensos são invisíveis para não-admin)
  const uid = App.currentUser?.id;
  const counts = { novidades: 0, builds: 0, guias: 0 };
  getPosts().forEach(p => {
    // Pula posts suspensos que o usuário atual não pode ver
    if (!App.currentUser?.isAdmin && p.suspended && p.authorId !== uid) return;
    if (counts[p.type] === undefined) return; // tipo desconhecido — ignora
    if (
      normalize(p.title).includes(query) ||
      normalize(p.desc).includes(query)  ||
      p.tags.some(t => normalize(t).includes(query))
    ) counts[p.type]++;
  });

  const total = counts.novidades + counts.builds + counts.guias;

  if (total === 0) {
    showToast(`Nenhum resultado para "${raw}"`, 'info');
    return;
  }

  /*
    Navega para a seção com MAIS resultados.
    Usamos App._searchNav = true para que showPage() saiba que a navegação
    foi acionada pela busca e NÃO limpe o App.searchQuery nem o campo.
  */
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  App._searchNav = true;
  showPage(best);          // renderPage() dentro de showPage() vai filtrar pelos resultados
  App._searchNav = false;

  showToast(`${total} resultado(s) para "${raw}"`, 'success');
}


// ===========================================================
// TOASTS (notificações temporárias)
// ===========================================================
/*
  Exibe uma mensagem de notificação que desaparece após 3 segundos.
  Muito similar ao toast do agent.html, mas com 4 tipos de estilo:
  'info', 'success', 'error', 'warn'

  POR QUE appendChild ao container em vez de criar direto no body?
  → O container #toast tem position:fixed no CSS e gerencia o empilhamento
    de múltiplos toasts. Se houvesse vários toasts ao mesmo tempo,
    ficariam organizados no container.

  A animação toastOut é definida no CSS (style.css).
*/
function showToast(message, type = 'info') {
  const container = document.getElementById('toast');
  const item = document.createElement('div');
  item.className   = `toast-item toast-${type}`;
  item.textContent = message;
  container.appendChild(item);

  setTimeout(() => {
    item.style.animation = 'toastOut .3s ease forwards'; // inicia animação de saída
    setTimeout(() => item.remove(), 300); // remove após a animação terminar
  }, 3000); // começa a sair após 3 segundos
}


// ===========================================================
// MINHAS POSTAGENS
// ===========================================================
/*
  Página pessoal do usuário com seus próprios posts de Build e Guia.
  (Novidades não aparecem aqui pois são exclusivas do admin)

  showMyPosts() → define a aba ativa e navega para a página.
  renderMyPosts() → gera o HTML da página com os posts do usuário.

  POR QUE uma página separada em vez de filtrar nas páginas principais?
  → Melhor UX: o usuário tem um espaço dedicado para gerenciar seus posts.
    Também facilita mostrar estado vazio personalizado ("crie sua primeira build!").
*/
function showMyPosts(type) {
  App.myPostsTab = type || 'builds';
  showPage('myposts');
}

function renderMyPosts() {
  const page = document.getElementById('page-myposts');
  if (!page) return;

  const uid  = App.currentUser?.id;
  if (!uid) return; // sem login, não renderiza

  const type = App.myPostsTab || 'builds';

  // Filtra apenas os posts do usuário logado, ordenados por mais recentes
  let posts = getPostsByType(type).filter(p => p.authorId === uid);
  posts.sort((a, b) => b.timestamp - a.timestamp);

  const emptyLabel = type === 'builds' ? 'build' : 'guia';
  const newLabel   = type === 'builds' ? 'Build' : 'Guia';
  const emptyIcon  = type === 'builds' ? '⚔️' : '📖';

  const cardsHtml = posts.length === 0
    ? `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">${emptyIcon}</div>
        <div class="empty-state-title">Nenhuma ${emptyLabel} publicada ainda</div>
        <p>Crie sua primeira ${emptyLabel} e compartilhe com a comunidade!</p>
        <button class="btn btn-primary" style="margin:1rem auto;display:flex"
          onclick="openNewPostModal('${type}')">+ Criar ${newLabel}</button>
      </div>`
    : posts.map(p => buildPostCard(p)).join('');

  page.innerHTML = `
    <div class="container">
      <div class="myposts-header">
        <div class="myposts-tabs">
          <button class="myposts-tab ${type === 'builds' ? 'active' : ''}"
            onclick="showMyPosts('builds')">⚔️ Minhas Builds</button>
          <button class="myposts-tab ${type === 'guias' ? 'active' : ''}"
            onclick="showMyPosts('guias')">📖 Meus Guias</button>
        </div>
        <button class="btn btn-primary" onclick="openNewPostModal('${type}')">
          + Nova ${newLabel}
        </button>
      </div>
      <div class="posts-grid">${cardsHtml}</div>
    </div>`;
}


// ===========================================================
// CONFIGURAÇÕES
// ===========================================================
/*
  Página de configurações do usuário.
  Atualmente exibe placeholders para funcionalidades futuras:
  - Editar perfil
  - Notificações
  - Aparência
  - Segurança

  POR QUE implementar a página sem as funcionalidades?
  → Permite criar a estrutura visual e o fluxo de navegação
    antes de implementar cada funcionalidade individualmente.
*/
function showSettings() {
  showPage('settings');
}

// ===========================================================
// ATUALIZAR AVATAR NA NAVBAR
// ===========================================================
/*
  Lê o avatar do usuário atual e atualiza o círculo do canto superior direito.
  Se o usuário tem foto → mostra a imagem, esconde a inicial.
  Se não tem foto      → mostra a inicial, esconde a imagem.

  POR QUE função separada?
  → É chamada tanto no login quanto após salvar o perfil, sem duplicar código.
*/
function refreshNavbarAvatar() {
  const user = App.currentUser;
  if (!user) return;

  const initial = document.getElementById('userInitial');
  const img     = document.getElementById('userAvatarImg');

  if (user.avatar) {
    // Usuário tem foto: exibe a imagem e esconde a inicial
    if (img) { img.src = user.avatar; img.classList.remove('hidden'); }
    if (initial) initial.classList.add('hidden');
  } else {
    // Sem foto: exibe a inicial e esconde a imagem
    if (img) img.classList.add('hidden');
    if (initial) {
      initial.textContent = user.name[0].toUpperCase();
      initial.classList.remove('hidden');
    }
  }
}


// ===========================================================
// CONFIGURAÇÕES — PERFIL DO USUÁRIO
// ===========================================================
/*
  Quando o usuário seleciona uma imagem no input de avatar,
  lê o arquivo como base64 (formato que pode ser guardado no
  localStorage como texto) e atualiza o preview na tela.

  POR QUE base64?
  → O localStorage só aceita strings. Base64 converte qualquer
    arquivo binário (imagem) em uma string de texto.
    Desvantagem: ocupa ~33% mais espaço do que o arquivo original.
    Para avatares pequenos isso é aceitável.

  POR QUE limitar a 500KB?
  → localStorage tem limite de ~5MB por domínio. Com vários dados
    do site já guardados, reservamos no máximo 500KB para o avatar.
*/
function handleProfileAvatarChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 500 * 1024) {
    showToast('Imagem muito grande — máximo 500KB', 'error');
    return;
  }

  // FileReader lê o arquivo e chama onload quando terminar
  const reader = new FileReader();
  reader.onload = (e) => {
    App._pendingAvatar = e.target.result; // guarda o base64 temporariamente

    // Atualiza o preview circular na tela sem salvar ainda
    const preview = document.getElementById('profileAvatarPreview');
    if (preview) {
      preview.innerHTML = `
        <img src="${App._pendingAvatar}" alt="Pré-visualização do avatar" />
        <div class="profile-avatar-overlay">📷 Trocar</div>
      `;
    }
  };
  reader.readAsDataURL(file); // inicia a leitura
}

/*
  Salva as alterações de perfil (nome, bio, avatar) no localStorage
  e na sessionStorage (sessão ativa), depois atualiza a navbar.
*/
function handleSaveProfile() {
  const nameVal = document.getElementById('profileName')?.value.trim();
  const bioVal  = document.getElementById('profileBio')?.value.trim() || '';

  if (!nameVal || nameVal.length < 2) {
    showToast('O nome deve ter pelo menos 2 caracteres.', 'error');
    return;
  }

  // Atualiza o registro permanente do usuário no localStorage
  const users = getUsers();
  const idx   = users.findIndex(u => u.id === App.currentUser.id);
  if (idx !== -1) {
    users[idx].name = nameVal;
    users[idx].bio  = bioVal;
    // _pendingAvatar: undefined = não mudou; null = removido; string = nova imagem
    if (App._pendingAvatar !== undefined) users[idx].avatar = App._pendingAvatar;
    saveUsers(users);
  }

  // Atualiza o objeto de sessão (em memória e sessionStorage)
  App.currentUser.name = nameVal;
  App.currentUser.bio  = bioVal;
  if (App._pendingAvatar !== undefined) App.currentUser.avatar = App._pendingAvatar;
  sessionStorage.setItem('drk_session', JSON.stringify({ id: App.currentUser.id, adminVerified: App.currentUser.id === 'admin' }));

  // Atualiza o nome no menu dropdown e a foto/inicial na navbar
  document.getElementById('userMenuName').textContent = '👤 ' + nameVal;
  refreshNavbarAvatar();

  App._pendingAvatar = undefined; // limpa o pendente após salvar
  showToast('Perfil atualizado com sucesso! 🐉', 'success');
}

/*
  Abre ou fecha o corpo de uma seção de configurações (acordeão).

  COMO FUNCIONA O ACORDEÃO?
  Cada seção tem:
  - Um header clicável (.settings-section-header) com título e seta
  - Um corpo (.settings-section-body) que expande/colapsa via CSS

  A animação usa "max-height": quando fechado, max-height é 0 e overflow
  está oculto. Quando aberto, max-height passa para um valor grande (9999px).
  O CSS faz a transição suavemente entre os dois estados.

  POR QUE max-height E NÃO display:none?
  → display:none não aceita animação CSS. max-height sim, porque é uma
    propriedade numérica e o navegador consegue interpolar os valores.
*/
function toggleSettingsSection(id) {
  const body  = document.getElementById('stg-body-' + id);
  const arrow = document.getElementById('stg-arrow-' + id);
  if (!body) return;

  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);   // adiciona/remove a classe "open"
  if (arrow) arrow.classList.toggle('open', !isOpen); // gira a seta
}

function renderSettings() {
  const page = document.getElementById('page-settings');
  if (!page) return;

  if (!App.currentUser) {
    page.innerHTML = `
      <div class="container">
        <div class="settings-header">
          <h2 class="settings-title">⚙️ Configurações</h2>
        </div>
        <p style="color:var(--text-secondary)">Faça login para acessar as configurações.</p>
      </div>`;
    return;
  }

  App._pendingAvatar = undefined;

  const user       = App.currentUser;
  const bioLen     = (user.bio || '').length;
  const avatarInner = user.avatar
    ? `<img src="${user.avatar}" alt="Avatar atual" />`
    : `<span>${user.name[0].toUpperCase()}</span>`;

  /*
    Função auxiliar que gera o HTML de uma seção de acordeão.
    Parâmetros:
    - id:      identificador único (usado nos IDs do DOM)
    - icon:    emoji do ícone
    - title:   texto do título
    - content: HTML do corpo da seção
    - open:    se true, começa expandida
  */
  const section = (id, icon, title, content, open = false) => `
    <div class="settings-section">
      <div class="settings-section-header" onclick="toggleSettingsSection('${id}')">
        <div class="settings-section-title">${icon} ${title}</div>
        <span class="settings-section-arrow ${open ? 'open' : ''}" id="stg-arrow-${id}">›</span>
      </div>
      <div class="settings-section-body ${open ? 'open' : ''}" id="stg-body-${id}">
        ${content}
      </div>
    </div>`;

  page.innerHTML = `
    <div class="container">
      <div class="settings-header">
        <h2 class="settings-title">⚙️ Configurações</h2>
        <p class="settings-subtitle">Gerencie suas preferências pessoais</p>
      </div>
      <div class="settings-sections">

        ${section('perfil', '👤', 'Perfil', `
          <div class="profile-avatar-area">
            <div class="profile-avatar-preview" id="profileAvatarPreview"
                 onclick="document.getElementById('profileAvatarInput').click()"
                 title="Clique para trocar a foto">
              ${avatarInner}
              <div class="profile-avatar-overlay">📷 Trocar</div>
            </div>
            <input type="file" id="profileAvatarInput" accept="image/*"
                   style="display:none" onchange="handleProfileAvatarChange(event)" />
            <p class="profile-avatar-hint">Clique na foto para trocar · máx. 500 KB</p>
          </div>

          <div class="form-group" style="margin-top:1.5rem">
            <label class="form-label" for="profileName">Nome exibido</label>
            <input class="input" type="text" id="profileName"
                   value="${escapeHtml(user.name)}" maxlength="40"
                   placeholder="Seu nome público..." />
          </div>

          <div class="form-group">
            <label class="form-label" for="profileBio">
              Bio <span id="bioCounter" class="bio-counter">${bioLen}/260</span>
            </label>
            <textarea class="input profile-bio-input" id="profileBio"
                      rows="4" maxlength="260"
                      placeholder="Conte um pouco sobre você..."
                      oninput="document.getElementById('bioCounter').textContent = this.value.length + '/260'"
            >${escapeHtml(user.bio || '')}</textarea>
          </div>

          <button class="btn btn-primary" onclick="handleSaveProfile()">💾 Salvar Perfil</button>
        `)}

        ${section('notif', '🔔', 'Notificações', `
          <!--
            SEÇÃO DE PREFERÊNCIAS DE NOTIFICAÇÃO
            O toggle abaixo permite silenciar o badge vermelho do sino.
            Quando silenciado, as notificações ainda são RECEBIDAS e ficam no painel,
            mas o sino não pisca/fica vermelho para não incomodar o usuário.

            POR QUE salvar em user.notifMuted e não separado?
            → Fica junto com os outros dados do usuário, fácil de acessar de qualquer
              lugar do código. Se o usuário trocar de dispositivo e os dados forem migrados,
              a preferência vai junto.
          -->
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <div class="settings-toggle-label">Silenciar notificações</div>
              <div class="settings-toggle-desc">
                Quando ativado, o sino não ficará vermelho ao receber novas notificações.
                Você ainda pode clicar nele para ver o painel normalmente.
              </div>
            </div>
            <!--
              O atributo "checked" é adicionado dinamicamente: se user.notifMuted for true,
              o toggle já começa marcado. A função toggleNotifMute() é chamada a cada mudança.
            -->
            <label class="settings-toggle-switch" title="Silenciar notificações">
              <input type="checkbox" id="notifMuteToggle"
                     ${App.currentUser.notifMuted ? 'checked' : ''}
                     onchange="toggleNotifMute(this.checked)" />
              <span class="settings-toggle-thumb"></span>
            </label>
          </div>
        `)}

        ${section('appar', '🎨', 'Aparência', `
          <div class="settings-placeholder">Em breve: tema, fonte e preferências visuais.</div>
        `)}

        ${section('segur', '🔒', 'Segurança', `
          <div class="settings-placeholder">Em breve: alterar senha e autenticação em dois fatores.</div>
        `)}

      </div>
    </div>`;
}


// ===========================================================
// SEGURANÇA — ESCAPE DE HTML
// ===========================================================
/*
  Converte caracteres especiais HTML em entidades seguras.
  ESSENCIAL para prevenir ataques XSS (Cross-Site Scripting).

  O QUE É XSS?
  → Se um usuário criar um post com o título:
    <script>document.cookie = 'hacked'</script>
    E inserirmos esse título diretamente no innerHTML,
    o script seria executado no browser de quem visitar o site.

  escapeHtml() previne isso convertendo:
  < → &lt;   (menos-que)
  > → &gt;   (maior-que)
  & → &amp;  (e comercial)
  " → &quot; (aspas duplas)
  etc.

  Assim o texto aparece como texto visível, não como código executável.

  SEGURANÇA (24/10/2026): a versão antiga usava createTextNode, que
  escapa < > & mas NÃO escapa aspas. Como o texto também vai dentro de
  atributos (value="...", alt="...", title="..."), um título com aspas
  podia "fechar" o atributo e injetar código. Agora trocamos os cinco
  caracteres perigosos, aspas incluídas, pelos códigos HTML seguros.

  Esta função é chamada em todo lugar que exibimos dados do usuário
  (títulos, descrições, nomes) no innerHTML.
*/
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')   // & primeiro, para não estragar os próximos
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// ===========================================================
// NOTIFICAÇÕES — SINO E PAINEL
// ===========================================================
/*
  O sino aparece na barra de navegação quando o usuário está logado.
  Ao clicar, abre um painel flutuante com as últimas notificações.

  COMO FUNCIONA O SISTEMA DE NOTIFICAÇÕES?
  1. Quando alguém que você segue posta um Build ou Guia,
     pushNotification() é chamada e salva a notificação em
     localStorage com a chave 'drk_notif_ID' (ID = seu ID de usuário).
  2. renderNotificationBell() conta quantas estão não-lidas
     e exibe o número em vermelho no badge.
  3. toggleNotifPanel() abre/fecha o painel. Ao abrir, todas
     as notificações são marcadas como lidas.

  POR QUE GUARDAR POR USUÁRIO NO LOCALSTORAGE?
  → Cada usuário tem sua própria lista, isolada.
    'drk_notif_user-123' só pertence ao usuário com id 'user-123'.
*/

// Atualiza o badge (bolinha vermelha) do sino com o nº de não-lidas
function renderNotificationBell() {
  // Se não há usuário logado, não faz nada
  if (!App.currentUser) return;

  const notifs  = getNotifications(App.currentUser.id);
  const unread  = notifs.filter(n => !n.read).length; // conta as não-lidas

  const badge = document.getElementById('notifBadge');
  if (!badge) return;

  /*
    REGRA DO SILENCIAMENTO:
    Se o usuário escolheu silenciar (notifMuted = true), o badge NUNCA aparece,
    mesmo que existam mensagens não lidas. O sino continua funcionando normalmente
    — ao clicar, o painel abre e mostra todas as notificações.
    A ideia é: o usuário ainda recebe tudo, mas não é "perturbado" visualmente.
  */
  if (unread > 0 && !App.currentUser.notifMuted) {
    // Mostra o badge com o número (máximo exibido: 99+)
    badge.classList.remove('hidden');
    badge.textContent = unread > 99 ? '99+' : String(unread);
  } else {
    // Esconde o badge: ou não há não-lidas, ou as notificações estão silenciadas
    badge.classList.add('hidden');
  }
}

/*
  Ativa ou desativa o silenciamento de notificações.
  Chamado pelo toggle na aba Notificações das Configurações.

  PARÂMETRO:
  - muted (boolean): true = silenciar, false = reativar

  COMO FUNCIONA?
  1. Busca o usuário no localStorage
  2. Salva o novo valor de notifMuted
  3. Atualiza App.currentUser e sessionStorage (sessão atual)
  4. Chama renderNotificationBell() para o badge sumir/aparecer imediatamente
*/
function toggleNotifMute(muted) {
  if (!App.currentUser) return;

  // Busca a lista de usuários e encontra o índice do usuário logado
  const users   = getUsers();
  const myIndex = users.findIndex(u => u.id === App.currentUser.id);
  if (myIndex === -1) return;

  // Atualiza o campo no localStorage
  users[myIndex].notifMuted = muted;
  saveUsers(users);

  // Atualiza o objeto em memória (App.currentUser) e na sessão do browser
  // Isso garante que a preferência vale imediatamente, sem precisar relogar
  App.currentUser.notifMuted = muted;
  sessionStorage.setItem('drk_session', JSON.stringify({ id: App.currentUser.id, adminVerified: App.currentUser.id === 'admin' }));

  // Atualiza o badge do sino imediatamente para refletir a mudança
  renderNotificationBell();

  // Informa o usuário sobre a mudança
  if (muted) {
    showToast('Notificações silenciadas. O sino não ficará mais vermelho.', 'info');
  } else {
    showToast('Notificações reativadas!', 'success');
  }
}

// Abre ou fecha o painel de notificações
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;

  const isOpen = !panel.classList.contains('hidden');

  if (isOpen) {
    // Fecha o painel
    panel.classList.add('hidden');
    return;
  }

  // Abre o painel: primeiro marca todas como lidas
  if (App.currentUser) {
    const notifs = getNotifications(App.currentUser.id);
    const updated = notifs.map(n => ({ ...n, read: true })); // copia cada notif com read: true
    saveNotifications(App.currentUser.id, updated);
    renderNotificationBell(); // zera o badge
  }

  // Renderiza o conteúdo do painel
  panel.innerHTML = buildNotifPanelHtml();
  panel.classList.remove('hidden');

  // Clique fora do painel fecha ele
  setTimeout(() => {
    document.addEventListener('click', closeNotifOnClickOutside, { once: true });
  }, 0);
}

// Fecha o painel se o clique foi fora dele ou do sino
function closeNotifOnClickOutside(e) {
  const panel = document.getElementById('notifPanel');
  const bell  = document.getElementById('notifBell');
  if (!panel) return;
  if (!panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.add('hidden');
  } else {
    // O clique foi dentro: reregistra o listener para manter o comportamento
    document.addEventListener('click', closeNotifOnClickOutside, { once: true });
  }
}

// Gera o HTML interno do painel de notificações
function buildNotifPanelHtml() {
  if (!App.currentUser) return '';

  const notifs = getNotifications(App.currentUser.id);

  if (notifs.length === 0) {
    return `<div class="notif-empty">Nenhuma notificação ainda.<br>Siga usuários para receber atualizações!</div>`;
  }

  // Formata o tempo relativo da notificação (ex: "há 2 horas")
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min  = Math.floor(diff / 60000);
    if (min < 1)   return 'agora mesmo';
    if (min < 60)  return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `há ${h}h`;
    const d = Math.floor(h / 24);
    return `há ${d} dia${d > 1 ? 's' : ''}`;
  }

  // Gera uma linha para cada notificação
  const items = notifs.slice(0, 30).map(n => {
    let icon = '🔔';
    let texto = '';

    if (n.type === 'new_post') {
      icon  = n.postType === 'builds' ? '⚒️' : '📖';
      texto = `<strong>${escapeHtml(n.fromUserName)}</strong> publicou um ${n.typeLabel}: <em>${escapeHtml(n.postTitle)}</em>`;
    } else {
      texto = escapeHtml(n.title || 'Nova notificação');
    }

    // Clicar na notificação abre o post correspondente e fecha o painel
    const clickable = n.postId
      ? `onclick="document.getElementById('notifPanel').classList.add('hidden'); showPostDetail('${n.postId}')" style="cursor:pointer"`
      : '';

    return `
      <div class="notif-item" ${clickable}>
        <span class="notif-icon">${icon}</span>
        <div class="notif-text">
          <div>${texto}</div>
          <div class="notif-time">${timeAgo(n.timestamp)}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="notif-header">Notificações</div>
    <div class="notif-list">${items}</div>`;
}


// ===========================================================
// PERFIS PÚBLICOS DE USUÁRIOS
// ===========================================================
/*
  Qualquer usuário pode visitar o perfil de qualquer outro usuário.
  O perfil mostra: avatar, nome, bio, estatísticas (posts, seguidores,
  seguindo), botão de seguir/deixar de seguir, e a lista de posts
  publicados por aquele usuário.

  FLUXO:
  1. Usuário clica no nome/avatar do autor de um post
  2. showProfile(userId) é chamada → salva o ID em App.currentProfileId
     e navega para a página #page-profile
  3. showPage('profile') chama renderProfile() que monta o HTML
  4. Se o visitante clicar "Seguir", toggleFollow() atualiza o array
     following do usuário logado e dispara notificação (futura)
*/

// Navega até o perfil do usuário com o ID informado
function showProfile(userId) {
  // Não abre perfil de admin — conta administrativa não tem página pública
  if (userId === 'admin') return;

  App.currentProfileId = userId;
  showPage('profile');
}

// Renderiza toda a página de perfil (chamada por showPage('profile'))
function renderProfile() {
  const page = document.getElementById('page-profile');
  if (!page) return;

  // Se não há usuário alvo definido, mostra o próprio perfil do logado
  const targetId = App.currentProfileId || App.currentUser?.id;
  if (!targetId) {
    page.innerHTML = '<p style="padding:2rem;color:var(--text-secondary)">Nenhum perfil selecionado.</p>';
    return;
  }

  // Busca o usuário alvo no banco de dados local
  const users  = getUsers();
  let target   = users.find(u => u.id === targetId);

  // Tratamento especial para a conta admin (não está no array de usuários)
  if (!target && targetId === 'admin') {
    target = { id: 'admin', name: 'Administrador', bio: '', avatar: null, following: [] };
  }

  if (!target) {
    page.innerHTML = '<p style="padding:2rem;color:var(--text-secondary)">Usuário não encontrado.</p>';
    return;
  }

  // Posts públicos deste usuário (não suspensos)
  const allPosts   = getPosts();
  const userBuilds = allPosts.filter(p => p.authorId === targetId && p.type === 'builds' && !p.suspended);
  const userGuias  = allPosts.filter(p => p.authorId === targetId && p.type === 'guias'  && !p.suspended);

  // Contagem de seguidores: quantos usuários têm este ID no seu array following
  const followersCount  = users.filter(u => (u.following || []).includes(targetId)).length;
  const followingCount  = (target.following || []).length;

  // Verifica se o usuário logado já segue este perfil
  const amFollowing = App.currentUser
    ? (App.currentUser.following || []).includes(targetId)
    : false;

  // Não exibe botão de seguir no próprio perfil
  const isOwnProfile = App.currentUser?.id === targetId;

  // Avatar: imagem base64 ou inicial do nome com cor de fundo
  const avatarHtml = target.avatar
    ? `<img class="profile-avatar-img" src="${target.avatar}" alt="Avatar de ${escapeHtml(target.name)}" />`
    : `<div class="profile-avatar-initial">${(target.name || '?')[0].toUpperCase()}</div>`;

  // Botão de seguir/deixar de seguir (só para usuários logados visitando outro perfil)
  let followBtnHtml = '';
  if (App.currentUser && !isOwnProfile) {
    followBtnHtml = `
      <button class="follow-btn ${amFollowing ? 'following' : ''}"
              onclick="toggleFollow('${targetId}')">
        ${amFollowing ? '✓ Seguindo' : '+ Seguir'}
      </button>`;
  }

  // Gera os cards de post para a grade do perfil (versão simplificada)
  function profilePostCard(p) {
    const thumb = p.cardImage
      ? `<img class="ppc-thumb-img" src="${p.cardImage}" alt="${escapeHtml(p.title)}" />`
      : postMonogram(p, 'ppc-thumb-emoji');
    return `
      <div class="profile-post-card" onclick="showPostDetail('${p.id}')" style="cursor:pointer">
        <div class="ppc-thumb">${thumb}</div>
        <div class="ppc-info">
          <div class="ppc-title">${escapeHtml(p.title)}</div>
          <div class="ppc-date">${p.date}</div>
        </div>
      </div>`;
  }

  // Grade de builds
  const buildsGrid = userBuilds.length > 0
    ? userBuilds.map(profilePostCard).join('')
    : `<p class="profile-empty">Nenhuma build publicada.</p>`;

  // Grade de guias
  const guiasGrid = userGuias.length > 0
    ? userGuias.map(profilePostCard).join('')
    : `<p class="profile-empty">Nenhum guia publicado.</p>`;

  page.innerHTML = `
    <div class="profile-page">

      <!-- Cabeçalho do perfil: avatar, nome, bio, botão seguir -->
      <div class="profile-header">
        <div class="profile-avatar-display">${avatarHtml}</div>
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(target.name)}</div>
          ${target.bio
            ? `<p class="profile-bio">${escapeHtml(target.bio)}</p>`
            : '<p class="profile-bio profile-bio--empty">Sem bio ainda.</p>'}
          ${followBtnHtml}
        </div>
      </div>

      <!-- Estatísticas rápidas: posts, seguidores, seguindo -->
      <div class="profile-stats">
        <div class="profile-stat">
          <span class="profile-stat-value">${userBuilds.length + userGuias.length}</span>
          <span class="profile-stat-label">Posts</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-value">${followersCount}</span>
          <span class="profile-stat-label">Seguidores</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-value">${followingCount}</span>
          <span class="profile-stat-label">Seguindo</span>
        </div>
      </div>

      <!-- Seção de Builds -->
      <div class="profile-section">
        <div class="profile-section-title">⚒️ Builds (${userBuilds.length})</div>
        <div class="profile-posts-grid">${buildsGrid}</div>
      </div>

      <!-- Seção de Guias -->
      <div class="profile-section">
        <div class="profile-section-title">📖 Guias (${userGuias.length})</div>
        <div class="profile-posts-grid">${guiasGrid}</div>
      </div>

    </div>`;
}

/*
  Alterna seguir/deixar de seguir um usuário.
  O array 'following' fica guardado no objeto do usuário logado no localStorage.
  Ao seguir, uma notificação futura poderá ser disparada aqui também.
*/
function toggleFollow(targetUserId) {
  // Segurança: só usuários logados podem seguir
  if (!App.currentUser) {
    showToast('Faça login para seguir usuários.', 'info');
    return;
  }
  // Não pode seguir a si mesmo
  if (App.currentUser.id === targetUserId) return;

  const users   = getUsers();
  const myIndex = users.findIndex(u => u.id === App.currentUser.id);
  if (myIndex === -1) return; // usuário não encontrado (ex: admin)

  const following = users[myIndex].following || [];
  const already   = following.includes(targetUserId);

  if (already) {
    // Deixa de seguir: remove o ID do array
    users[myIndex].following = following.filter(id => id !== targetUserId);
    showToast('Você deixou de seguir este usuário.', 'info');
  } else {
    // Passa a seguir: adiciona o ID ao array
    users[myIndex].following = [...following, targetUserId];
    showToast('Você agora está seguindo este usuário!', 'success');
  }

  saveUsers(users); // persiste no localStorage

  // Atualiza App.currentUser para refletir a mudança (sem precisar recarregar)
  App.currentUser.following = users[myIndex].following;
  sessionStorage.setItem('drk_session', JSON.stringify({ id: App.currentUser.id, adminVerified: App.currentUser.id === 'admin' })); // atualiza a sessão

  // Re-renderiza o perfil para atualizar o botão de seguir e as estatísticas
  renderProfile();
}


// ===========================================================
// INICIALIZAÇÃO — executado quando a página termina de carregar
// ===========================================================
/*
  DOMContentLoaded → evento disparado quando o HTML foi completamente
  lido e o DOM está pronto, mas antes das imagens carregarem.
  POR QUE usar este evento em vez de colocar o código direto?
  → Garante que todos os elementos HTML existem antes de tentar
    manipulá-los. Sem isso, getElementById() retornaria null.

  SEQUÊNCIA DE INICIALIZAÇÃO:
  1. seedDefaultPosts(): garante que há conteúdo inicial
  2. restoreSession(): restaura login se o usuário estava logado
  3. renderHome(): exibe o conteúdo da home

  EVENTOS GLOBAIS REGISTRADOS:
  - Escape: fecha lightbox, modais e menu mobile
  - Click fora da navbar: fecha menu mobile
  - Enter nos campos de login/cadastro: submete o formulário
*/
document.addEventListener('DOMContentLoaded', () => {
  seedDefaultPosts(); // popula posts de exemplo se for a primeira vez
  seedTestGuias();    // insere 15 guias de teste para visualização da paginação
  applySeedCovers();  // coloca prints oficiais da Steam como capa dos posts de exemplo
  restoreSession();   // restaura login salvo na sessionStorage
  renderHome();       // renderiza o conteúdo inicial da home

  // Tecla Escape: fecha o que estiver aberto na seguinte prioridade:
  // 1. Lightbox (visualizador de imagem) → 2. Modais → 3. Menu mobile
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const lb = document.querySelector('.lightbox-backdrop');
      if (lb) { lb.remove(); return; } // fecha lightbox primeiro
      closeModal('authModal');
      closeModal('postModal');
      closeMobileMenu();
    }
  });

  // Clicar fora da navbar fecha o menu mobile
  // navbar.contains(e.target) → verifica se o clique foi DENTRO da navbar
  document.addEventListener('click', e => {
    if (!document.getElementById('navbar').contains(e.target)) closeMobileMenu();
  });

  /*
    Verificação de embed ao digitar/colar URL do YouTube no formulário.
    Usamos debounce de 800ms: só dispara a consulta depois que o usuário
    para de digitar por 800ms, evitando requisições desnecessárias a cada tecla.
  */
  document.getElementById('postYoutube').addEventListener('input', () => {
    clearTimeout(App._ytDebounce);
    App._ytDebounce = setTimeout(
      () => checkYouTubeEmbed(document.getElementById('postYoutube').value.trim()),
      800
    );
  });

  // Enter no campo de senha do login submete o formulário
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  // Enter no campo de confirmação de senha do cadastro submete o formulário
  document.getElementById('regConfirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });

  /*
    EFEITO PARALLAX da imagem de capa na página inicial.

    O QUE É PARALLAX?
    Parallax é um efeito visual onde elementos em planos diferentes se movem
    em velocidades distintas durante o scroll — criando a ilusão de profundidade.
    Aqui: o conteúdo rola na velocidade normal, mas a imagem de fundo rola
    mais devagar (40% da velocidade), como se estivesse "atrás" do conteúdo.

    COMO FUNCIONA?
    - window.scrollY: quantos pixels o usuário já rolou desde o topo da página.
    - fator 0.4: a imagem se desloca apenas 40% do scroll total.
      (ex: usuário rolou 100px → imagem se desloca 40px)
    - { passive: true }: diz ao browser que este listener nunca vai chamar
      preventDefault(), permitindo que o scroll seja mais fluido.

    POR QUE NÃO USAR background-attachment: fixed?
    → fixed congela a imagem completamente (0% de movimento).
      Parallax quer movimento, só que mais lento que o conteúdo.
      Além disso, fixed tem problemas no iOS/Safari mobile.
  */
  const homeEl    = document.getElementById('page-home');
  const flashEl   = document.getElementById('homeBgFlash');
  let   flashLock = false; // impede que novos scrolls reiniciem a animação no meio dela

  window.addEventListener('scroll', () => {
    // Só age enquanto a home estiver ativa
    if (!homeEl.classList.contains('active')) return;

    /*
      ANIMAÇÃO DE TROCA: a capa2.png aparece e some a cada scroll.
      flashLock impede que scroll contínuo recomece a animação
      antes dela terminar — evita piscar repetidamente.
    */
    if (flashLock) return;
    flashLock = true;

    // Dispara a animação CSS (definida no @keyframes capaFlash)
    flashEl.style.animation = 'none'; // reseta forçando reflow
    flashEl.offsetHeight;             // força o browser a aplicar o reset antes de continuar
    flashEl.style.animation = 'capaFlash 0.6s ease forwards';

    // Libera o lock quando a animação terminar para o próximo scroll
    flashEl.addEventListener('animationend', () => {
      flashLock = false;
      flashEl.style.animation = 'none';
    }, { once: true });

  }, { passive: true });
});
