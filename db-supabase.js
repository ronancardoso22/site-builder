/*
  ===========================================================
  DB-SUPABASE.JS — liga o site ao banco de dados de verdade
  Criado em 25/10/2026
  ===========================================================

  O QUE FAZ
  O backend.js foi escrito para guardar tudo no localStorage. Este
  arquivo troca, por baixo, as funções de "banco" (getPosts, savePosts,
  getUsers, saveUsers, notificações, login e cadastro) por versões que
  falam com o Supabase. O resto do site continua igual.

  COMO FUNCIONA
  - Ao abrir o site, os posts são baixados do banco e ficam numa
    memória rápida (DB.posts). getPosts() lê dessa memória.
  - savePosts(lista) compara a lista nova com a memória e manda para o
    banco só o que mudou (criar, editar, apagar).
  - Imagens coladas (base64) são enviadas ao Storage antes, e o post
    guarda só o endereço da imagem.

  SEGURANÇA
  - Este arquivo NÃO decide quem pode o quê. Quem decide é o banco
    (regras RLS em supabase/01-banco.sql). Mesmo que alguém mexa neste
    código pelo F12, o banco recusa.
  - Tudo que vem do banco passa de novo pelas limpezas do backend.js
    (sanitizePost, sanitizeUser) antes de aparecer na tela.
  - Se a chave colada for a "secret", o site para e avisa.

  Se supabase-config.js estiver vazio, este arquivo não faz nada.
*/
(function () {
  'use strict';

  const CFG = window.DRK_SUPABASE || {};
  const VERSAO_POLITICA = '2026-10-25'; // mude quando alterar a Política de Privacidade

  if (!CFG.url && !CFG.anonKey) return; // modo antigo (localStorage)

  function pararComErro(msg) {
    console.error('[Drakbuilder] ' + msg);
    document.addEventListener('DOMContentLoaded', () => showToast(msg, 'error'));
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CFG.url || '')) {
    return pararComErro('Configuração do banco inválida: confira o url em supabase-config.js.');
  }
  // Recusa a chave secreta: ela passaria por cima de todas as regras do banco.
  const chave = String(CFG.anonKey || '');
  let chaveOk = chave.startsWith('sb_publishable_');
  if (!chaveOk && chave.startsWith('eyJ')) {
    try {
      const corpo = JSON.parse(atob(chave.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      chaveOk = corpo.role === 'anon';
    } catch (e) { chaveOk = false; }
  }
  if (!chaveOk) {
    return pararComErro('A chave em supabase-config.js não é a chave pública. Use só a "publishable"/"anon". NUNCA a secret/service_role.');
  }
  if (!window.supabase?.createClient) {
    return pararComErro('Biblioteca do Supabase não carregou (vendor/supabase-2.117.3.js).');
  }

  const sb = window.supabase.createClient(CFG.url, chave, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const DB = {
    posts: [],            // posts já limpos (sanitizePost)
    perfis: new Map(),    // id -> { id, name, bio, avatar }
    contagens: new Map(), // id -> { seguidores, seguindo }
    seguindo: [],         // ids que o usuário logado segue
    notifs: [],           // notificações do usuário logado
    eu: null,             // dados do usuário logado
    fila: Promise.resolve(),
  };

  const COLS_POST = 'id,type,title,descr,emoji,tags,card_image,sections,youtube_url,youtube_embeddable,suspended,created_at,author_id,autor:profiles(id,name,avatar_url)';
  const PREFIXO_IMG = CFG.url + '/storage/v1/object/public/imagens/';
  const ehUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

  // Mensagens de erro: as nossas (do banco, em português) aparecem; o resto vira genérica
  function msgErro(err, padrao) {
    const m = String(err?.message || '');
    if (err?.code === 'P0001' && m.length < 200) return m;
    if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
    if (/network|fetch/i.test(m)) return 'Sem conexão com o banco. Confira sua internet.';
    return padrao;
  }

  // ---------------------------------------------------------
  // IMAGENS: aceita também as que estão no Storage deste projeto
  // ---------------------------------------------------------
  const safeImageUrlAntigo = window.safeImageUrl;
  window.safeImageUrl = function (u) {
    if (typeof u === 'string' && u.startsWith(PREFIXO_IMG)
        && /^[A-Za-z0-9/_.-]+$/.test(u.slice(PREFIXO_IMG.length)) && !u.includes('..')) return u;
    return safeImageUrlAntigo(u);
  };

  // base64 -> arquivo no Storage (pasta do próprio usuário) -> endereço público
  const jaEnviadas = new Map();
  async function enviarImagem(dataUrl) {
    if (jaEnviadas.has(dataUrl)) return jaEnviadas.get(dataUrl);
    const m = /^data:(image\/(png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m || !DB.eu) throw new Error('Imagem inválida.');
    const bin = atob(m[3].replace(/\s/g, ''));
    if (bin.length > 2 * 1024 * 1024) throw Object.assign(new Error('Imagem maior que 2 MB.'), { code: 'P0001' });
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }[m[2]];
    const caminho = `${DB.eu.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('imagens')
      .upload(caminho, new Blob([bytes], { type: m[1] }), { contentType: m[1], cacheControl: '31536000', upsert: false });
    if (error) {
      // O banco limita 60 imagens por hora (e 1000 no total) por pessoa
      if (/row-level security|policy|403/i.test(String(error.message || error.statusCode || ''))) {
        throw Object.assign(new Error('Limite de envio de imagens atingido. Tente de novo mais tarde.'), { code: 'P0001' });
      }
      throw error;
    }
    const url = sb.storage.from('imagens').getPublicUrl(caminho).data.publicUrl;
    jaEnviadas.set(dataUrl, url);
    return url;
  }

  // Percorre o objeto inteiro e troca toda imagem base64 pelo endereço no Storage
  async function trocarImagensBase64(valor) {
    if (typeof valor === 'string') return valor.startsWith('data:image/') ? enviarImagem(valor) : valor;
    if (Array.isArray(valor)) { const r = []; for (const v of valor) r.push(await trocarImagensBase64(v)); return r; }
    if (valor && typeof valor === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(valor)) r[k] = await trocarImagensBase64(v);
      return r;
    }
    return valor;
  }

  // Lista as imagens do Storage (da pasta do usuário) usadas por um post
  function imagensDoMeuStorage(obj, lista = []) {
    if (typeof obj === 'string') {
      const pref = PREFIXO_IMG + (DB.eu?.id || '-') + '/';
      if (obj.startsWith(pref)) lista.push(obj.slice(PREFIXO_IMG.length));
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(v => imagensDoMeuStorage(v, lista));
    }
    return lista;
  }

  // ---------------------------------------------------------
  // POSTS
  // ---------------------------------------------------------
  function linhaParaPost(r) {
    const t = Date.parse(r.created_at) || Date.now();
    if (r.autor) DB.perfis.set(r.autor.id, { ...(DB.perfis.get(r.autor.id) || {}), id: r.autor.id, name: r.autor.name, avatar: r.autor.avatar_url });
    return sanitizePost({
      id: r.id, type: r.type, title: r.title, desc: r.descr, emoji: r.emoji, tags: r.tags || [],
      authorId: r.author_id, author: r.autor?.name || 'Usuário',
      date: new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
      timestamp: t, cardImage: r.card_image, sections: r.sections || [],
      youtubeUrl: r.youtube_url, youtubeEmbeddable: r.youtube_embeddable, suspended: r.suspended,
    });
  }

  function postParaLinha(p) {
    return {
      id: p.id, type: p.type, title: String(p.title || '').trim(), descr: p.desc || '',
      emoji: p.emoji || null, tags: p.tags || [], card_image: p.cardImage || null,
      sections: p.sections || [], youtube_url: p.youtubeUrl || null,
      youtube_embeddable: p.youtubeEmbeddable ?? null, suspended: !!p.suspended,
    };
  }

  async function recarregarPosts() {
    const { data, error } = await sb.from('posts').select(COLS_POST).order('created_at', { ascending: false }).limit(2000);
    if (error) { showToast(msgErro(error, 'Não foi possível carregar os posts.'), 'error'); return; }
    DB.posts = data.map(linhaParaPost).filter(Boolean);
  }

  window.getPosts = () => DB.posts.map(p => ({ ...p }));

  window.savePosts = function (lista) {
    const antes = new Map(DB.posts.map(p => [p.id, p]));
    const novos = (Array.isArray(lista) ? lista : []).map(sanitizePost).filter(Boolean);
    const ops = [];
    for (const p of novos) {
      const a = antes.get(p.id);
      if (!a) ops.push(['criar', p]);
      else if (JSON.stringify(a) !== JSON.stringify(p)) ops.push(['editar', p]);
    }
    const idsNovos = new Set(novos.map(p => p.id));
    for (const [id, p] of antes) if (!idsNovos.has(id)) ops.push(['apagar', p]);
    DB.posts = novos; // a tela já mostra a mudança; o banco confirma em seguida
    DB.fila = DB.fila.then(() => gravarPosts(ops));
  };

  async function gravarPosts(ops) {
    let falhou = null;
    for (const [op, p] of ops) {
      try {
        if (op === 'apagar') {
          const { data: apagados, error } = await sb.from('posts').delete().eq('id', p.id).select('id');
          if (error) throw error;
          if (!apagados?.length) throw Object.assign(new Error('Você não tem permissão para apagar este post.'), { code: 'P0001' });
          const arquivos = imagensDoMeuStorage(p);
          if (arquivos.length) await sb.storage.from('imagens').remove(arquivos);
          continue;
        }
        const linha = await trocarImagensBase64(postParaLinha(p));
        if (op === 'criar') delete linha.suspended; // post novo nunca nasce suspenso
        else delete linha.id;                       // o id de um post nunca muda
        const consulta = op === 'criar'
          ? sb.from('posts').insert(linha).select(COLS_POST)
          : sb.from('posts').update(linha).eq('id', p.id).select(COLS_POST);
        const { data, error } = await consulta;
        if (error) throw error;
        if (!data?.length) throw Object.assign(new Error('Você não tem permissão para alterar este post.'), { code: 'P0001' });
        const salvo = linhaParaPost(data[0]);
        DB.posts = DB.posts.map(x => (x.id === salvo.id ? salvo : x));
      } catch (e) {
        console.error('[Drakbuilder] erro ao gravar post', e);
        falhou = e;
      }
    }
    if (falhou) {
      showToast(msgErro(falhou, 'Não foi possível salvar no banco. Nada foi perdido do que já estava salvo.'), 'error');
      await recarregarPosts();
      rerenderAtivo();
    }
  }

  // Os posts de exemplo do modo antigo não são criados no banco
  window.seedDefaultPosts = () => {};
  window.seedTestGuias   = () => {};
  window.applySeedCovers = () => {};

  // ---------------------------------------------------------
  // PERFIS E SEGUIDORES
  // ---------------------------------------------------------
  window.getUsers = function () {
    const lista = [...DB.perfis.values()].map(p => ({ ...p, following: [] }));
    if (DB.eu) {
      const i = lista.findIndex(u => u.id === DB.eu.id);
      const eu = { ...DB.eu, following: [...DB.seguindo] };
      if (i === -1) lista.push(eu); else lista[i] = eu;
    }
    return lista.map(sanitizeUser).filter(Boolean);
  };

  window.saveUsers = function (lista) {
    if (!DB.eu) return;
    const novo = (lista || []).find(u => u.id === DB.eu.id);
    if (!novo) return;
    const antigo = { ...DB.eu };
    const seguiaAntes = [...DB.seguindo];
    const seguindoAgora = (novo.following || []).filter(ehUuid);
    DB.eu = { ...DB.eu, name: novo.name, bio: novo.bio || null, avatar: novo.avatar || null, notifMuted: !!novo.notifMuted };
    DB.seguindo = seguindoAgora;
    DB.fila = DB.fila.then(() => gravarEu(antigo, seguiaAntes));
  };

  async function gravarEu(antigo, seguiaAntes) {
    const eu = DB.eu;
    try {
      const mudou = {};
      if (eu.name !== antigo.name) mudou.name = eu.name;
      if ((eu.bio || null) !== (antigo.bio || null)) mudou.bio = eu.bio;
      if (eu.notifMuted !== antigo.notifMuted) mudou.notif_muted = eu.notifMuted;
      if ((eu.avatar || null) !== (antigo.avatar || null)) {
        mudou.avatar_url = eu.avatar ? await trocarImagensBase64(eu.avatar) : null;
      }
      if (Object.keys(mudou).length) {
        const { error } = await sb.from('profiles').update(mudou).eq('id', eu.id);
        if (error) throw error;
        if ('avatar_url' in mudou) {
          eu.avatar = mudou.avatar_url;
          if (App.currentUser) App.currentUser.avatar = mudou.avatar_url;
          const velhas = imagensDoMeuStorage(antigo.avatar);
          if (velhas.length) await sb.storage.from('imagens').remove(velhas);
        }
        DB.perfis.set(eu.id, { id: eu.id, name: eu.name, bio: eu.bio, avatar: eu.avatar });
      }
      const comecou = DB.seguindo.filter(id => !seguiaAntes.includes(id));
      const parou   = seguiaAntes.filter(id => !DB.seguindo.includes(id));
      for (const id of comecou) {
        const { error } = await sb.from('follows').insert({ follower_id: eu.id, followed_id: id });
        if (error && error.code !== '23505') throw error;
      }
      if (parou.length) {
        const { error } = await sb.from('follows').delete().eq('follower_id', eu.id).in('followed_id', parou);
        if (error) throw error;
      }
      for (const id of [...comecou, ...parou]) DB.contagens.delete(id);
      if (comecou.length || parou.length) {
        if (document.getElementById('page-profile')?.classList.contains('active')) window.renderProfile();
      }
    } catch (e) {
      console.error('[Drakbuilder] erro ao salvar perfil', e);
      showToast(msgErro(e, 'Não foi possível salvar seu perfil no banco.'), 'error');
      await carregarEu();
    }
  }

  // Nome: 3 a 40 letras, sem símbolos de código (o banco também confere)
  const handleSaveProfileAntigo = window.handleSaveProfile;
  window.handleSaveProfile = function () {
    const nome = document.getElementById('profileName')?.value.trim() || '';
    if (nome.length < 3 || nome.length > 40) { showToast('O nome deve ter de 3 a 40 caracteres.', 'error'); return; }
    if (/[<>"'`\\]/.test(nome)) { showToast('O nome não pode ter os símbolos < > " \' ` \\', 'error'); return; }
    return handleSaveProfileAntigo();
  };

  // Perfil público: busca no banco se ainda não conhece, e corrige contagens
  async function buscarPerfil(id) {
    const { data } = await sb.from('profiles').select('id,name,bio,avatar_url').eq('id', id).maybeSingle();
    if (data) DB.perfis.set(id, { id, name: data.name, bio: data.bio, avatar: data.avatar_url });
    return !!data;
  }
  async function buscarContagem(id) {
    const { data } = await sb.rpc('contagem_seguidores', { alvo: id });
    if (data) DB.contagens.set(id, { seguidores: Number(data.seguidores) || 0, seguindo: Number(data.seguindo) || 0 });
  }

  const renderProfileAntigo = window.renderProfile;
  window.renderProfile = function () {
    const alvo = App.currentProfileId || App.currentUser?.id;
    const perfil = DB.perfis.get(alvo);
    if (ehUuid(alvo) && (!perfil || perfil.bio === undefined)) {
      buscarPerfil(alvo).then(achou => { if (achou) window.renderProfile(); });
    }
    renderProfileAntigo();
    const c = DB.contagens.get(alvo);
    const valores = document.querySelectorAll('#page-profile .profile-stat-value');
    if (c && valores.length >= 3) {
      valores[1].textContent = String(c.seguidores);
      valores[2].textContent = String(c.seguindo);
    } else if (ehUuid(alvo) && !c) {
      if (valores.length >= 3) { valores[1].textContent = '…'; valores[2].textContent = '…'; }
      buscarContagem(alvo).then(() => {
        if (DB.contagens.has(alvo) && document.getElementById('page-profile')?.classList.contains('active')) window.renderProfile();
      });
    }
  };

  // ---------------------------------------------------------
  // NOTIFICAÇÕES (criadas pelo próprio banco quando alguém posta)
  // ---------------------------------------------------------
  async function carregarNotificacoes() {
    if (!DB.eu) { DB.notifs = []; return; }
    const { data, error } = await sb.from('notifications')
      .select('id,type,read,created_at,post_id,from_user_id,de:profiles!from_user_id(name),post:posts(title,type)')
      .order('created_at', { ascending: false }).limit(50);
    if (!error) DB.notifs = data;
  }

  window.getNotifications = function () {
    const rotulo = { builds: 'Build', guias: 'Guia' };
    return DB.notifs.map(n => ({
      id: n.id, type: 'new_post', read: !!n.read,
      postId: isSafeId(n.post_id) ? n.post_id : null,
      fromUserId: ehUuid(n.from_user_id) ? n.from_user_id : null,
      fromUserName: plainText(n.de?.name || 'Alguém', 60),
      postTitle: longText(n.post?.title || '(post removido)', 200),
      postType: n.post?.type || null,
      typeLabel: rotulo[n.post?.type] || 'Post',
      timestamp: Date.parse(n.created_at) || Date.now(),
    }));
  };

  window.saveNotifications = function (userId, lista) {
    if (!DB.eu || userId !== DB.eu.id) return;
    const novas = new Map((lista || []).map(n => [n.id, n]));
    const apagar = DB.notifs.filter(n => !novas.has(n.id)).map(n => n.id);
    const lidas  = DB.notifs.filter(n => novas.has(n.id) && novas.get(n.id).read && !n.read).map(n => n.id);
    DB.notifs = DB.notifs.filter(n => novas.has(n.id)).map(n => ({ ...n, read: !!novas.get(n.id).read }));
    DB.fila = DB.fila.then(async () => {
      if (lidas.length)  await sb.from('notifications').update({ read: true }).in('id', lidas);
      if (apagar.length) await sb.from('notifications').delete().in('id', apagar);
    });
  };

  window.pushNotification = () => {};  // o banco cria sozinho (gatilho notificar_seguidores)
  window.getFollowers     = () => [];

  // ---------------------------------------------------------
  // LOGIN, CADASTRO, SAIR, ESQUECI A SENHA
  // ---------------------------------------------------------
  async function carregarEu() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { DB.eu = null; return null; }
    const [perfil, seg] = await Promise.all([
      sb.rpc('meu_perfil'),
      sb.from('follows').select('followed_id').eq('follower_id', user.id),
    ]);
    const p = perfil.data;
    if (!p) { DB.eu = null; return null; }
    DB.seguindo = (seg.data || []).map(r => r.followed_id);
    DB.eu = {
      id: user.id, email: user.email, name: p.name, bio: p.bio, avatar: p.avatar_url,
      notifMuted: !!p.notif_muted, isAdmin: p.role === 'admin',
      createdAt: new Date(p.created_at).toLocaleDateString('pt-BR'),
    };
    DB.perfis.set(user.id, { id: user.id, name: p.name, bio: p.bio, avatar: p.avatar_url });
    return DB.eu;
  }

  const loginUserAntigo = window.loginUser;
  const logoutAntigo    = window.logout;

  async function entrarNaTela() {
    const eu = await carregarEu();
    if (!eu) return;
    await Promise.all([carregarNotificacoes(), recarregarPosts()]);
    const u = sanitizeUser({ ...eu, following: [...DB.seguindo] });
    loginUserAntigo(u);
    // loginUser() antigo só reconhece o admin "virtual"; aqui quem diz é o banco.
    // (Isso só mostra botões. Quem permite ou bloqueia de verdade é o RLS.)
    App.currentUser.isAdmin = !!eu.isAdmin;
    App.currentUser.notifMuted = eu.notifMuted;
    document.getElementById('userAvatar')?.classList.toggle('is-admin', !!eu.isAdmin);
    document.getElementById('btnNewNovidade')?.classList.toggle('hidden', !eu.isAdmin);
    document.getElementById('menuItemNovidades')?.classList.toggle('hidden', !eu.isAdmin);
    sessionStorage.removeItem('drk_session'); // a sessão agora é do Supabase
    renderNotificationBell();
    rerenderAtivo();
  }

  window.restoreSession = () => {}; // o Supabase restaura sozinho (evento INITIAL_SESSION)

  // ---------------------------------------------------------
  // CAPTCHA (Cloudflare Turnstile) — 25/10/2026
  // Só liga se supabase-config.js tiver turnstileSiteKey. O Supabase
  // confere o token no servidor (Auth > Attack Protection). A chave daqui
  // é pública; a chave secreta fica só no painel do Supabase.
  // ---------------------------------------------------------
  const CAPTCHA_KEY = /^[0-9A-Za-z_-]{10,100}$/.test(String(CFG.turnstileSiteKey || '')) ? CFG.turnstileSiteKey : '';
  const captcha = { login: { id: null, token: null }, cadastro: { id: null, token: null } };
  let captchaCarregando = null;

  function carregarTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (captchaCarregando) return captchaCarregando;
    captchaCarregando = new Promise((ok, falha) => {
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.async = true; sc.defer = true;
      sc.onload = () => ok();
      sc.onerror = () => { captchaCarregando = null; falha(new Error('captcha')); };
      document.head.appendChild(sc);
    });
    return captchaCarregando;
  }

  function montarCaptcha(qual, seletorBotao) {
    const botao = document.querySelector(seletorBotao);
    if (!botao || captcha[qual].id !== null) return;
    let caixa = document.getElementById('drkCaptcha-' + qual);
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.id = 'drkCaptcha-' + qual;
      caixa.style.cssText = 'margin:.5rem 0;min-height:65px';
      botao.parentNode.insertBefore(caixa, botao);
    }
    carregarTurnstile().then(() => {
      if (captcha[qual].id !== null) return;
      captcha[qual].id = window.turnstile.render(caixa, {
        sitekey: CAPTCHA_KEY, theme: 'dark', language: 'pt-br',
        callback: t => { captcha[qual].token = t; },
        'expired-callback': () => { captcha[qual].token = null; },
        'error-callback': () => { captcha[qual].token = null; },
      });
    }).catch(() => showToast('Não foi possível carregar a verificação anti-robô. Recarregue a página.', 'error'));
  }

  // Devolve o token (ou null se faltar). Cada token só vale uma vez.
  function pegarCaptcha(qual) {
    if (!CAPTCHA_KEY) return undefined;
    const t = captcha[qual].token;
    if (!t) { showToast('Confirme a verificação "não sou um robô" antes de continuar.', 'info'); return null; }
    return t;
  }
  function renovarCaptcha(qual) {
    if (!CAPTCHA_KEY || !window.turnstile || captcha[qual].id === null) return;
    captcha[qual].token = null;
    try { window.turnstile.reset(captcha[qual].id); } catch (e) { /* ignora */ }
  }

  if (CAPTCHA_KEY) {
    document.addEventListener('DOMContentLoaded', () => {
      montarCaptcha('login', '[onclick="handleLogin()"]');
      montarCaptcha('cadastro', '[onclick="handleRegister()"]');
    });
  }

  let entrando = false;
  window.handleLogin = async function () {
    const email = document.getElementById('loginEmail').value.trim();
    const senha = document.getElementById('loginPassword').value;
    if (!email || !senha) { showToast('Preencha e-mail e senha!', 'error'); return; }
    if (entrando) return;
    const captchaToken = pegarCaptcha('login');
    if (captchaToken === null) return;
    entrando = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha, options: { captchaToken } });
      renovarCaptcha('login');
      if (error) {
        const msg = /captcha/i.test(error.message) ? 'A verificação anti-robô falhou. Tente de novo.'
          : /confirm/i.test(error.message) ? 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada e o spam).'
          : /rate|many/i.test(error.message) ? 'Muitas tentativas. Espere alguns minutos.'
          : 'E-mail ou senha incorretos!';
        showToast(msg, 'error');
        return;
      }
      document.getElementById('loginPassword').value = '';
      closeModal('authModal');
    } finally { entrando = false; }
  };

  let cadastrando = false;
  window.handleRegister = async function () {
    const nome   = document.getElementById('regName').value.trim();
    const email  = document.getElementById('regEmail').value.trim();
    const senha  = document.getElementById('regPassword').value;
    const conf   = document.getElementById('regConfirm').value;
    const idade  = document.getElementById('regIdade')?.checked;
    const aceite = document.getElementById('regPrivacidade')?.checked;

    if (!nome || !email || !senha || !conf) { showToast('Preencha todos os campos!', 'error'); return; }
    if (nome.length < 3 || nome.length > 40) { showToast('O nome deve ter de 3 a 40 caracteres.', 'error'); return; }
    if (/[<>"'`\\]/.test(nome)) { showToast('O nome não pode ter os símbolos < > " \' ` \\', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('E-mail inválido!', 'error'); return; }
    if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) {
      showToast('A senha precisa de pelo menos 8 caracteres, com letras e números.', 'error'); return;
    }
    if (senha !== conf) { showToast('As senhas não coincidem!', 'error'); return; }
    if (!idade)  { showToast('É preciso ter 13 anos ou mais para criar conta.', 'error'); return; }
    if (!aceite) { showToast('Para criar conta, leia e aceite a Política de Privacidade.', 'error'); return; }
    if (cadastrando) return;
    const captchaToken = pegarCaptcha('cadastro');
    if (captchaToken === null) return;
    cadastrando = true;
    try {
      const { data, error } = await sb.auth.signUp({
        email, password: senha,
        options: {
          captchaToken,
          emailRedirectTo: location.origin + location.pathname,
          data: { name: nome, consent_version: VERSAO_POLITICA, age_13_plus: true },
        },
      });
      renovarCaptcha('cadastro');
      if (error) {
        const msg = /captcha/i.test(error.message) ? 'A verificação anti-robô falhou. Tente de novo.'
          : /password/i.test(error.message) ? 'Essa senha é fraca ou já vazou em outro site. Escolha outra.'
          : /rate|many/i.test(error.message) ? 'Muitas tentativas. Espere alguns minutos.'
          : 'Não foi possível criar a conta. Confira os dados e tente de novo.';
        showToast(msg, 'error');
        return;
      }
      ['regPassword', 'regConfirm'].forEach(id => { document.getElementById(id).value = ''; });
      closeModal('authModal');
      // Com sessão, o aviso de boas-vindas vem do evento SIGNED_IN
      if (!data.session) showToast('Quase lá! Enviamos um link de confirmação para o seu e-mail.', 'success');
    } finally { cadastrando = false; }
  };

  window.logout = async function () {
    await sb.auth.signOut().catch(() => {});
  };

  window.esqueciSenha = async function () {
    const email = document.getElementById('loginEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Digite seu e-mail no campo acima e clique de novo.', 'info'); return; }
    const captchaToken = pegarCaptcha('login');
    if (captchaToken === null) return;
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname, captchaToken });
    renovarCaptcha('login');
    // Mesma resposta exista ou não a conta (não revela quem é cadastrado)
    showToast('Se existir uma conta com esse e-mail, enviamos um link para criar nova senha.', 'info');
  };

  // Janela simples para digitar a senha nova (link do e-mail ou Configurações)
  function pedirSenhaNova(titulo) {
    document.getElementById('drkSenhaModal')?.remove();
    const box = document.createElement('div');
    box.className = 'modal-backdrop';
    box.id = 'drkSenhaModal';
    box.innerHTML = `
      <div class="modal">
        <p class="modal-title" style="font-size:1rem;margin-bottom:1rem;"></p>
        <div class="modal-form">
          <div class="form-group"><label class="form-label" for="drkSenha1">Nova senha</label>
            <input class="input" type="password" id="drkSenha1" autocomplete="new-password" placeholder="Mínimo 8, com letras e números" /></div>
          <div class="form-group"><label class="form-label" for="drkSenha2">Repita a nova senha</label>
            <input class="input" type="password" id="drkSenha2" autocomplete="new-password" /></div>
          <button class="btn btn-primary" id="drkSenhaOk" style="width:100%;justify-content:center">Salvar nova senha</button>
          <button class="btn" id="drkSenhaCancelar" style="width:100%;justify-content:center;margin-top:.5rem">Cancelar</button>
        </div>
      </div>`;
    box.querySelector('.modal-title').textContent = titulo;
    document.body.appendChild(box);
    box.querySelector('#drkSenhaCancelar').onclick = () => box.remove();
    box.querySelector('#drkSenhaOk').onclick = async () => {
      const s1 = box.querySelector('#drkSenha1').value, s2 = box.querySelector('#drkSenha2').value;
      if (s1.length < 8 || !/[A-Za-z]/.test(s1) || !/[0-9]/.test(s1)) { showToast('Mínimo 8 caracteres, com letras e números.', 'error'); return; }
      if (s1 !== s2) { showToast('As senhas não coincidem!', 'error'); return; }
      const { error } = await sb.auth.updateUser({ password: s1 });
      if (error) { showToast(/same|different/i.test(error.message) ? 'A senha nova precisa ser diferente da atual.' : 'Não foi possível trocar a senha. Entre de novo e tente outra vez.', 'error'); return; }
      box.remove();
      showToast('Senha trocada com sucesso!', 'success');
    };
    box.querySelector('#drkSenha1').focus();
  }
  window.drkTrocarSenha = () => pedirSenhaNova('Trocar senha');

  // O Supabase avisa quando alguém entra, sai, ou abre o link de "nova senha".
  // (setTimeout: o Supabase pede para não chamar o banco dentro deste aviso.)
  sb.auth.onAuthStateChange((evento, sessao) => {
    setTimeout(async () => {
      if (evento === 'PASSWORD_RECOVERY') { pedirSenhaNova('Crie sua nova senha'); return; }
      if ((evento === 'INITIAL_SESSION' || evento === 'SIGNED_IN') && sessao?.user) {
        if (App.currentUser?.id === sessao.user.id) return;
        await entrarNaTela();
        if (evento === 'SIGNED_IN') showToast(`Bem-vindo, ${DB.eu?.name || 'Aventureiro'}! 🐉`, 'success');
      } else if (evento === 'SIGNED_OUT') {
        DB.eu = null; DB.seguindo = []; DB.notifs = [];
        if (App.currentUser) logoutAntigo();
        await recarregarPosts();
        rerenderAtivo();
      }
    }, 0);
  });

  // Confere notificações novas a cada 2 minutos (só com a aba aberta e visível)
  setInterval(async () => {
    if (!DB.eu || document.hidden) return;
    await carregarNotificacoes();
    renderNotificationBell();
  }, 120000);

  // ---------------------------------------------------------
  // CONFIGURAÇÕES: Privacidade e dados (LGPD) + trocar senha
  // ---------------------------------------------------------
  const renderSettingsAntigo = window.renderSettings;
  window.renderSettings = function () {
    renderSettingsAntigo();
    const lista = document.querySelector('#page-settings .settings-sections');
    if (!lista || !DB.eu) return;
    // Tira o "Em breve" da seção Segurança: agora dá para trocar a senha
    const seg = document.getElementById('stg-body-segur');
    if (seg) seg.innerHTML = `
      <p style="color:var(--text-secondary);margin-bottom:1rem">Sua senha é guardada pelo Supabase com criptografia (bcrypt). Nem o administrador consegue vê-la.</p>
      <button class="btn btn-primary" onclick="drkTrocarSenha()">🔑 Trocar senha</button>`;

    const admin = DB.eu.isAdmin ? `
      <hr style="border-color:var(--border);margin:1.5rem 0">
      <p style="color:var(--text-secondary);margin-bottom:.75rem"><strong>Administrador:</strong> envia para o banco os posts que existem só neste navegador (posts antigos e os publicados pelo Drakantos Agent).</p>
      <button class="btn" onclick="drkImportarPostsLocais()">⬆️ Enviar posts deste navegador para o banco</button>` : '';

    lista.insertAdjacentHTML('beforeend', `
      <div class="settings-section">
        <div class="settings-section-header" onclick="toggleSettingsSection('lgpd')">
          <div class="settings-section-title">🛡️ Privacidade e meus dados</div>
          <span class="settings-section-arrow" id="stg-arrow-lgpd">›</span>
        </div>
        <div class="settings-section-body" id="stg-body-lgpd">
          <p style="color:var(--text-secondary);margin-bottom:1rem">
            Pela LGPD você pode ver, baixar, corrigir e apagar seus dados a qualquer momento.
            Leia a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.
          </p>
          <p style="color:var(--text-muted);margin-bottom:1rem;font-size:.9rem">Conta criada em ${escapeHtml(DB.eu.createdAt || '')}.</p>
          <div style="display:flex;gap:.75rem;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="drkExportarDados()">⬇️ Baixar meus dados</button>
            <button class="btn" style="border-color:var(--red);color:var(--red)" onclick="drkExcluirConta()">🗑️ Excluir minha conta</button>
          </div>
          ${admin}
        </div>
      </div>`);
  };

  window.drkExportarDados = async function () {
    const { data, error } = await sb.rpc('exportar_meus_dados');
    if (error) { showToast('Não foi possível gerar o arquivo agora.', 'error'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'meus-dados-drakbuilder.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast('Arquivo com seus dados baixado.', 'success');
  };

  window.drkExcluirConta = async function () {
    if (!DB.eu) return;
    const resp = prompt('Isso apaga para sempre sua conta, seu perfil, seus posts, imagens, seguidores e notificações.\n\nPara confirmar, digite EXCLUIR:');
    if (resp !== 'EXCLUIR') { if (resp !== null) showToast('Texto diferente de EXCLUIR. Nada foi apagado.', 'info'); return; }
    try {
      // 1. apaga as imagens da pasta da pessoa no Storage
      for (;;) {
        const { data: arqs, error } = await sb.storage.from('imagens').list(DB.eu.id, { limit: 100 });
        if (error) throw error;
        if (!arqs?.length) break;
        const { error: e2 } = await sb.storage.from('imagens').remove(arqs.map(a => `${DB.eu.id}/${a.name}`));
        if (e2) throw e2;
        if (arqs.length < 100) break;
      }
      // 2. apaga a conta (e, em cascata, perfil, posts, seguidores, notificações)
      const { error } = await sb.rpc('excluir_minha_conta');
      if (error) throw error;
      // 3. apaga rascunhos guardados neste navegador
      Object.keys(localStorage).filter(k => k.startsWith('drk_rascunho_')).forEach(k => localStorage.removeItem(k));
      await sb.auth.signOut().catch(() => {});
      DB.eu = null;
      if (App.currentUser) logoutAntigo();
      showToast('Sua conta e seus dados foram apagados.', 'success');
    } catch (e) {
      console.error('[Drakbuilder] erro ao excluir conta', e);
      showToast('Não foi possível excluir agora. Tente de novo ou fale com o administrador.', 'error');
    }
  };

  window.drkImportarPostsLocais = async function () {
    if (!DB.eu?.isAdmin) return;
    let locais = [];
    try { locais = JSON.parse(localStorage.getItem('drk_posts') || '[]'); } catch (e) { locais = []; }
    const jaNoBanco = new Set(DB.posts.map(p => p.id));
    const candidatos = (Array.isArray(locais) ? locais : []).map(sanitizePost).filter(p => p && p.authorId === 'admin' && !jaNoBanco.has(p.id));
    if (!candidatos.length) { showToast('Nenhum post novo do administrador neste navegador.', 'info'); return; }
    if (!confirm(`Enviar ${candidatos.length} post(s) deste navegador para o banco, com você como autor?`)) return;
    let ok = 0, erro = 0;
    for (const p of candidatos) {
      try {
        const linha = await trocarImagensBase64(postParaLinha(p));
        delete linha.suspended;
        const { data, error } = await sb.from('posts').insert(linha).select(COLS_POST);
        if (error) throw error;
        DB.posts.unshift(linhaParaPost(data[0])); ok++;
      } catch (e) { console.warn('[Drakbuilder] post não importado', p.id, e); erro++; }
    }
    await recarregarPosts();
    rerenderAtivo();
    showToast(`${ok} post(s) enviados${erro ? `, ${erro} com erro (veja o console F12)` : ''}.`, erro ? 'info' : 'success');
  };

  // ---------------------------------------------------------
  // REDESENHAR A PÁGINA ABERTA
  // ---------------------------------------------------------
  function rerenderAtivo() {
    if (App.inlineEditing) return;
    const ativa = document.querySelector('.page.active')?.id;
    if (ativa === 'page-editor' || document.querySelector('.page.active .ae-wizard')) return; // não atrapalha quem está escrevendo
    renderHome();
    if (ativa === 'page-detail' && App.currentDetailPostId) {
      if (DB.posts.some(p => p.id === App.currentDetailPostId)) showPostDetail(App.currentDetailPostId);
      else showPage('home');
    } else if (ativa === 'page-builds')    renderPage('builds');
    else if (ativa === 'page-guias')       renderPage('guias');
    else if (ativa === 'page-novidades')   renderPage('novidades');
    else if (ativa === 'page-myposts')     renderMyPosts();
    else if (ativa === 'page-profile')     window.renderProfile();
    else if (ativa === 'page-settings')    window.renderSettings();
  }

  // Primeira carga dos posts (o login, se houver, vem pelo INITIAL_SESSION)
  document.addEventListener('DOMContentLoaded', async () => {
    await recarregarPosts();
    if (!App.currentUser) rerenderAtivo();
  });

  console.info('[Drakbuilder] usando o banco Supabase.');
})();
