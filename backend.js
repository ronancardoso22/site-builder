// ===========================================================
  // ESTADO GLOBAL DA APLICAÇÃO
  // Um único objeto "App" centraliza as informações que precisam
  // ser lembradas enquanto o usuário navega pelo site.
  // ===========================================================
  const App = {
    currentUser: null,      // Guarda os dados do usuário logado. null = ninguém logado.
    currentPostType: null,  // Qual seção está sendo usada ao criar um post ('novidades', 'builds' ou 'guias')
    selectedTags: [],       // Lista das tags que o usuário marcou no formulário de criar post
    currentFilter: {        // Qual filtro de categoria está ativo em cada página
      novidades: 'all',     // 'all' = mostrar tudo (sem filtro aplicado)
      builds: 'all',
      guias: 'all',
    }
  };

  // ===========================================================
  // BANCO DE DADOS LOCAL (localStorage)
  // O localStorage é um "baú" no próprio navegador do usuário
  // onde salvamos dados entre visitas. Não precisa de servidor.
  // Os dados ficam salvos mesmo após fechar o navegador.
  // ===========================================================

  // Lê e retorna a lista de todos os usuários cadastrados
  function getUsers() {
    return JSON.parse(localStorage.getItem('drk_users') || '[]');
  }

  // Grava a lista de usuários atualizada no navegador
  function saveUsers(users) {
    localStorage.setItem('drk_users', JSON.stringify(users));
  }

  // Lê e retorna a lista de todos os posts (novidades, builds e guias juntos)
  function getPosts() {
    return JSON.parse(localStorage.getItem('drk_posts') || '[]');
  }

  // Grava a lista de posts atualizada no navegador
  function savePosts(posts) {
    localStorage.setItem('drk_posts', JSON.stringify(posts));
  }

  // Filtra e retorna apenas os posts de uma seção específica ('novidades', 'builds' ou 'guias')
  function getPostsByType(type) {
    return getPosts().filter(p => p.type === type);
  }

  // ===========================================================
  // POSTS PADRÃO (conteúdo inicial)
  // Na primeira vez que alguém acessa o site, não há nenhum post.
  // Esta função cria posts de exemplo para que o site não apareça vazio.
  // Após a primeira visita, esses posts ficam salvos e não são criados de novo.
  // ===========================================================
  function seedDefaultPosts() {
    // Se já existem posts salvos, não faz nada (evita duplicar os exemplos)
    if (getPosts().length > 0) return;

    const defaults = [
      // --- Posts iniciais de Novidades ---
      {
        id: 'seed-1', type: 'novidades', title: 'Patch 1.2.0 – A Era das Sombras',
        desc: 'Novos itens, masmorras e ajustes de balanceamento chegam ao Drakantos. Prepare-se para a batalha definitiva.',
        emoji: '🏰', tags: ['ATUALIZAÇÃO'],
        author: 'Equipe Drakantos', authorId: 'system',
        date: '22 de Junho, 2024', timestamp: Date.now() - 86400000 * 3
      },
      {
        id: 'seed-2', type: 'novidades', title: 'Evento: Investida dos Dracônios',
        desc: 'Participe do evento por tempo limitado e ganhe recompensas exclusivas. Colete fragmentos de dragão e forje artefatos lendários.',
        emoji: '🔥', tags: ['EVENTO'],
        author: 'Equipe Drakantos', authorId: 'system',
        date: '18 de Junho, 2024', timestamp: Date.now() - 86400000 * 7
      },
      {
        id: 'seed-3', type: 'novidades', title: 'Nova Região: Terras Ancestrais',
        desc: 'Explore as Terras Ancestrais e descubra segredos esquecidos. Uma nova história aguarda os aventureiros mais corajosos.',
        emoji: '🗺️', tags: ['NOTÍCIAS'],
        author: 'Equipe Drakantos', authorId: 'system',
        date: '15 de Junho, 2024', timestamp: Date.now() - 86400000 * 10
      },
      // --- Posts iniciais de Builds ---
      {
        id: 'seed-4', type: 'builds', title: 'Guerreiro – Fúria do Dragão',
        desc: 'Build focada em Dano Sustentado com ótima sobrevivência para conteúdo de Endgame. Ideal para masmorras longas e chefes de raid.',
        emoji: '⚔️', tags: ['PVE', 'ENDGAME'],
        author: 'DragonMaster', authorId: 'system',
        date: '20 de Junho, 2024', timestamp: Date.now() - 86400000 * 5
      },
      {
        id: 'seed-5', type: 'builds', title: 'Arqueiro – Flecha Sombria',
        desc: 'Especializada em Dano em Área e farm de recursos. Limpa grupos de inimigos com velocidade impressionante.',
        emoji: '🏹', tags: ['PVE', 'FARM'],
        author: 'ShadowArcher', authorId: 'system',
        date: '17 de Junho, 2024', timestamp: Date.now() - 86400000 * 8
      },
      {
        id: 'seed-6', type: 'builds', title: 'Mago – Tempestade Arcana',
        desc: 'Explosão Mágica devastadora tanto no PVE quanto no PVP. Domine o campo de batalha com feitiços de área.',
        emoji: '🔮', tags: ['PVE', 'PVP'],
        author: 'ArcaneWizard', authorId: 'system',
        date: '14 de Junho, 2024', timestamp: Date.now() - 86400000 * 11
      },
      // --- Posts iniciais de Guias ---
      {
        id: 'seed-7', type: 'guias', title: 'Guia para Iniciantes',
        desc: 'Dicas essenciais para começar bem sua jornada no Drakantos. Do tutorial à sua primeira masmorra, aprenda tudo aqui.',
        emoji: '📖', tags: ['INICIANTE'],
        author: 'Sábio Ancião', authorId: 'system',
        date: '10 de Junho, 2024', timestamp: Date.now() - 86400000 * 15
      },
      {
        id: 'seed-8', type: 'guias', title: 'Como Farmar Ouro Eficientemente',
        desc: 'Melhores métodos para acumular ouro rapidamente. Guia completo de rotas, horários e estratégias de economia.',
        emoji: '💰', tags: ['ECONOMIA'],
        author: 'GoldFarmer', authorId: 'system',
        date: '8 de Junho, 2024', timestamp: Date.now() - 86400000 * 17
      },
      {
        id: 'seed-9', type: 'guias', title: 'Masmorras e Raides',
        desc: 'Estratégias para enfrentar os maiores desafios do jogo. Formação de grupo, mecânicas de chefe e dicas avançadas.',
        emoji: '🏛️', tags: ['DUNGEON', 'AVANÇADO'],
        author: 'RaidLeader', authorId: 'system',
        date: '5 de Junho, 2024', timestamp: Date.now() - 86400000 * 20
      },
    ];

    savePosts(defaults);
  }

  // ===========================================================
  // MENU MOBILE (HAMBÚRGUER)
  // Abre e fecha o menu de navegação em telas pequenas.
  // ===========================================================
  function toggleMobileMenu() {
    const nav = document.querySelector('.nav-links');
    const btn = document.getElementById('navHamburger');
    nav.classList.toggle('open');
    btn.classList.toggle('open');
  }

  function closeMobileMenu() {
    document.querySelector('.nav-links').classList.remove('open');
    document.getElementById('navHamburger').classList.remove('open');
  }

  // ===========================================================
  // NAVEGAÇÃO ENTRE PÁGINAS
  // Como o site não recarrega ao navegar, esta função faz a troca
  // manualmente: remove "active" de todas as páginas e adiciona
  // apenas na que foi pedida, dando a sensação de navegação real.
  // ===========================================================
  function showPage(pageId) {
    // Remove a classe "active" de todas as páginas (oculta todas)
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // Adiciona "active" apenas na página destino (torna ela visível)
    const target = document.getElementById('page-' + pageId);
    if (target) target.classList.add('active');

    // Marca o link correspondente na navbar como ativo (sublinhado laranja magma)
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.page === pageId);
    });

    // Fecha o menu mobile ao trocar de página
    closeMobileMenu();

    // Volta ao topo da tela com animação suave
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Carrega e exibe o conteúdo correto para a página destino
    if (pageId === 'home')      renderHome();
    if (pageId === 'novidades') renderPage('novidades');
    if (pageId === 'builds')    renderPage('builds');
    if (pageId === 'guias')     renderPage('guias');
  }

  // ===========================================================
  // AUTENTICAÇÃO – CONTROLE DO MODAL
  // Funções para abrir, fechar e trocar as abas do modal de login.
  // ===========================================================

  // Mostra o modal de autenticação e garante que começa na aba de login
  function openAuthModal() {
    document.getElementById('authModal').classList.remove('hidden');
    switchAuthTab('login');
  }

  // Oculta o modal informado pelo seu ID no HTML
  function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  }

  // Fecha o modal se o usuário clicou no fundo escuro (fora da janela branca)
  function closeModalOnBackdrop(event, modalId) {
    if (event.target === document.getElementById(modalId)) {
      closeModal(modalId);
    }
  }

  // Alterna entre mostrar o formulário de login ou o de cadastro
  function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tabLogin').classList.toggle('active', isLogin);
    document.getElementById('tabRegister').classList.toggle('active', !isLogin);
    document.getElementById('formLogin').classList.toggle('hidden', !isLogin);
    document.getElementById('formRegister').classList.toggle('hidden', isLogin);
  }

  // ===========================================================
  // AUTENTICAÇÃO – LÓGICA DE LOGIN
  // Chamada quando o usuário clica em "Entrar no Jogo".
  // Verifica se o e-mail e senha batem com algum cadastro salvo.
  // ===========================================================
  function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    // Verifica se os campos foram preenchidos antes de continuar
    if (!email || !password) {
      showToast('Preencha e-mail e senha!', 'error');
      return;
    }

    // Procura um usuário com esse e-mail e senha no localStorage
    const users = getUsers();
    const user = users.find(u => u.email === email && u.password === password);

    if (!user) {
      showToast('E-mail ou senha incorretos!', 'error');
      return;
    }

    // Credenciais corretas: registra o usuário como logado
    loginUser(user);
    closeModal('authModal');
    showToast(`Bem-vindo de volta, ${user.name}! 🐉`, 'success');
  }

  // ===========================================================
  // AUTENTICAÇÃO – LÓGICA DE CADASTRO
  // Chamada quando o usuário clica em "Criar Conta".
  // Valida todos os campos e, se tudo estiver certo, cria a conta
  // e faz login automático logo em seguida.
  // ===========================================================
  function handleRegister() {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm  = document.getElementById('regConfirm').value;

    // Verifica se todos os campos foram preenchidos
    if (!name || !email || !password || !confirm) {
      showToast('Preencha todos os campos!', 'error'); return;
    }
    if (name.length < 3) {
      showToast('Nome deve ter ao menos 3 caracteres!', 'error'); return;
    }
    if (!email.includes('@')) {
      showToast('E-mail inválido!', 'error'); return;
    }
    if (password.length < 6) {
      showToast('Senha deve ter ao menos 6 caracteres!', 'error'); return;
    }
    if (password !== confirm) {
      showToast('As senhas não coincidem!', 'error'); return;
    }

    // Impede cadastro duplicado: verifica se esse e-mail já existe
    const users = getUsers();
    if (users.find(u => u.email === email)) {
      showToast('Este e-mail já está cadastrado!', 'error'); return;
    }

    // Monta o objeto do novo usuário com um ID único baseado no horário atual
    const newUser = {
      id: 'user-' + Date.now(),
      name,
      email,
      password,            // ATENÇÃO: em um site real a senha nunca ficaria em texto puro aqui!
      createdAt: new Date().toLocaleDateString('pt-BR')
    };

    // Adiciona o novo usuário à lista e salva no navegador
    users.push(newUser);
    saveUsers(users);

    // Loga o usuário automaticamente, sem precisar digitar e-mail e senha de novo
    loginUser(newUser);
    closeModal('authModal');
    showToast(`Conta criada! Bem-vindo, ${name}! 🐉`, 'success');
  }

  // ===========================================================
  // AUTENTICAÇÃO – SESSÃO DE USUÁRIO
  // Atualiza a interface visual para mostrar que o usuário está logado:
  // oculta o botão "Entrar", mostra o avatar com a inicial do nome,
  // e revela os botões de criar posts nas páginas.
  // ===========================================================
  function loginUser(user) {
    App.currentUser = user;

    // sessionStorage funciona como o localStorage, mas se apaga ao fechar a aba do navegador
    sessionStorage.setItem('drk_session', JSON.stringify(user));

    // Esconde o botão "Entrar" e mostra o avatar do usuário na navbar
    document.getElementById('btnEntrar').classList.add('hidden');
    const avatar = document.getElementById('userAvatar');
    avatar.classList.remove('hidden');
    document.getElementById('userInitial').textContent = user.name[0].toUpperCase();
    document.getElementById('userMenuName').textContent = '👤 ' + user.name;

    // Torna visíveis os botões de criar post (que ficam ocultos para quem não está logado)
    ['btnNewNovidade','btnNewBuild','btnNewGuia'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });

    // Atualiza a home para exibir o botão de deletar nos posts do próprio usuário
    renderHome();
  }

  // Desconecta o usuário: apaga a sessão e reverte a interface ao estado "deslogado"
  function logout() {
    App.currentUser = null;
    sessionStorage.removeItem('drk_session');

    document.getElementById('btnEntrar').classList.remove('hidden');
    document.getElementById('userAvatar').classList.add('hidden');

    // Oculta os botões de criar post novamente (só aparecem para logados)
    ['btnNewNovidade','btnNewBuild','btnNewGuia'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    showToast('Você saiu da conta. Até logo, Aventureiro!', 'info');
    renderHome();
  }

  // Ao recarregar a página, verifica se o usuário já estava logado e restaura o estado
  function restoreSession() {
    const session = sessionStorage.getItem('drk_session');
    if (session) {
      try { loginUser(JSON.parse(session)); } catch(e) {}
    }
  }

  // ===========================================================
  // CRIAÇÃO DE POSTS – MODAL
  // Controla a abertura do formulário e a seleção de tags.
  // ===========================================================

  // Lista de tags disponíveis para cada tipo de seção
  const TAG_OPTIONS = {
    novidades: ['ATUALIZAÇÃO', 'EVENTO', 'NOTÍCIAS'],
    builds:    ['PVE', 'PVP', 'FARM', 'ENDGAME'],
    guias:     ['INICIANTE', 'AVANÇADO', 'ECONOMIA', 'DUNGEON'],
  };

  // Emojis sugeridos como padrão ao abrir o formulário de cada seção
  const EMOJI_SUGGESTIONS = {
    novidades: ['📰','🔔','⚡','🔥','🎉','🏰'],
    builds:    ['⚔️','🏹','🔮','🛡️','🗡️','💥'],
    guias:     ['📖','💡','🗺️','💰','🏛️','🌟'],
  };

  // Abre o modal de criar post já configurado para a seção escolhida
  function openNewPostModal(type) {
    if (!App.currentUser) {
      openAuthModal();
      showToast('Faça login para criar um post!', 'info');
      return;
    }

    App.currentPostType = type;
    App.selectedTags = [];

    // Traduz o código interno da seção para um nome legível no título do modal
    const names = { novidades: 'Novidades', builds: 'Builds', guias: 'Guias' };
    document.getElementById('postModalTitle').textContent = '✍️ Novo Post em ' + names[type];
    document.getElementById('postSection').value = names[type];
    document.getElementById('postTitle').value = '';
    document.getElementById('postDesc').value = '';
    document.getElementById('postEmoji').value = EMOJI_SUGGESTIONS[type][0];

    // Cria os botões de tag clicáveis dinamicamente, de acordo com a seção
    const tagsContainer = document.getElementById('postTagsContainer');
    tagsContainer.innerHTML = '';
    TAG_OPTIONS[type].forEach(tag => {
      const btn = document.createElement('button');
      btn.textContent = tag;
      btn.className = 'filter-btn';
      btn.style.cssText = 'border-radius:4px;font-size:.68rem';
      btn.onclick = () => togglePostTag(tag, btn);
      tagsContainer.appendChild(btn);
    });

    document.getElementById('postModal').classList.remove('hidden');
  }

  // Marca ou desmarca uma tag quando o usuário clica nela no formulário
  function togglePostTag(tag, btn) {
    if (App.selectedTags.includes(tag)) {
      App.selectedTags = App.selectedTags.filter(t => t !== tag);
      btn.classList.remove('active');
    } else {
      App.selectedTags.push(tag);
      btn.classList.add('active');
    }
  }

  // ===========================================================
  // CRIAÇÃO DE POSTS – SALVAR
  // Chamada ao clicar em "Publicar Post". Valida os campos,
  // monta o objeto do post e salva no localStorage.
  // ===========================================================
  function handleCreatePost() {
    const title = document.getElementById('postTitle').value.trim();
    const desc  = document.getElementById('postDesc').value.trim();
    const emoji = document.getElementById('postEmoji').value.trim() || '📝';

    // Garante que título e descrição foram preenchidos antes de publicar
    if (!title) { showToast('O título é obrigatório!', 'error'); return; }
    if (!desc)  { showToast('A descrição é obrigatória!', 'error'); return; }
    if (title.length < 5) { showToast('Título muito curto!', 'error'); return; }

    // Gera a data de publicação no formato brasileiro (ex: "06 de maio de 2026")
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric'
    });

    // Cria o objeto do novo post com todos os dados necessários
    const newPost = {
      id:        'post-' + Date.now(),
      type:      App.currentPostType,
      title,
      desc,
      emoji,
      tags:      [...App.selectedTags],
      author:    App.currentUser.name,
      authorId:  App.currentUser.id,
      date:      dateStr,
      timestamp: Date.now(),
    };

    // Adiciona o novo post no início da lista (para aparecer primeiro) e salva
    const posts = getPosts();
    posts.unshift(newPost); // unshift = insere no início do array (ao contrário do push)
    savePosts(posts);

    closeModal('postModal');
    showToast('Post publicado com sucesso! 🐉', 'success');

    // Atualiza a página atual e a home para mostrar o post recém-criado
    renderPage(App.currentPostType);
    renderHome();
  }

  // ===========================================================
  // DELETAR POST
  // Só o autor do post pode deletar. Um botão "✕" aparece
  // sobre o card ao passar o mouse, mas só para o dono do post.
  // ===========================================================
  function deletePost(postId, event) {
    // Impede que o clique no botão de deletar "passe" para o card por baixo
    event.stopPropagation();

    if (!App.currentUser) return;

    const posts = getPosts();
    const post = posts.find(p => p.id === postId);

    if (!post) return;

    // Segurança: confere se o usuário logado realmente criou este post
    if (post.authorId !== App.currentUser.id) {
      showToast('Você só pode deletar seus próprios posts!', 'error');
      return;
    }

    // Exibe uma caixa de confirmação nativa do navegador antes de apagar
    if (!confirm(`Tem certeza que deseja deletar "${post.title}"?`)) return;

    // Cria uma nova lista sem o post deletado e salva no navegador
    const updated = posts.filter(p => p.id !== postId);
    savePosts(updated);

    showToast('Post deletado!', 'info');
    renderPage(post.type);
    renderHome();
  }

  // ===========================================================
  // RENDERIZAÇÃO – HOME
  // Busca os posts salvos e preenche as 3 colunas da home.
  // Usa .slice(0, 3) para pegar apenas os 3 primeiros de cada seção.
  // ===========================================================
  function renderHome() {
    // Pega os 3 posts mais recentes de novidades e exibe na coluna 1
    renderHomeNews(getPostsByType('novidades').slice(0, 3));
    // Pega as 3 builds mais recentes e exibe na coluna 2
    renderHomeBuilds(getPostsByType('builds').slice(0, 3));
    // Pega os 3 guias mais recentes e exibe na coluna 3
    renderHomeGuides(getPostsByType('guias').slice(0, 3));
  }

  function renderHomeNews(posts) {
    const container = document.getElementById('homeNewsList');
    if (!container) return;

    if (posts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Nenhuma novidade ainda.</p>';
      return;
    }

    container.innerHTML = posts.map(p => `
      <div class="news-card" onclick="showPage('novidades')">
        <div class="news-thumb">${p.emoji}</div>
        <div class="news-info">
          ${p.tags.map(t => `<span class="tag tag-${t.toLowerCase().replace('ç','c').replace('ã','a').replace('ó','o')}">${t}</span>`).join(' ')}
          <div class="news-title">${escapeHtml(p.title)}</div>
          <div class="news-desc">${escapeHtml(p.desc)}</div>
          <div class="news-date">${p.date}</div>
        </div>
      </div>
    `).join('');
  }

  function renderHomeBuilds(posts) {
    const container = document.getElementById('homeBuildsList');
    if (!container) return;

    if (posts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Nenhuma build ainda.</p>';
      return;
    }

    container.innerHTML = posts.map(p => `
      <div class="build-card" onclick="showPage('builds')">
        <div class="build-icon">${p.emoji}</div>
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

  function renderHomeGuides(posts) {
    const container = document.getElementById('homeGuidesList');
    if (!container) return;

    if (posts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Nenhum guia ainda.</p>';
      return;
    }

    container.innerHTML = posts.map(p => `
      <div class="guide-card" onclick="showPage('guias')">
        <div class="guide-icon">${p.emoji}</div>
        <div class="guide-info">
          <div class="guide-name">${escapeHtml(p.title)}</div>
          <div class="guide-desc">${escapeHtml(p.desc.substring(0, 60))}...</div>
        </div>
        <div class="build-arrow" style="color:var(--gold)">›</div>
      </div>
    `).join('');
  }

  // ===========================================================
  // RENDERIZAÇÃO – PÁGINAS INTERNAS (Novidades, Builds e Guias)
  // Busca os posts, aplica o filtro de categoria ativo, ordena
  // do mais novo para o mais antigo, e monta os cards na tela.
  // ===========================================================
  function renderPage(type) {
    const gridId = { novidades: 'novidadesGrid', builds: 'buildsGrid', guias: 'guiasGrid' }[type];
    const grid = document.getElementById(gridId);
    if (!grid) return;

    let posts = getPostsByType(type);

    // Se há um filtro de categoria ativo (diferente de 'all'), filtra os posts
    const activeFilter = App.currentFilter[type];
    if (activeFilter && activeFilter !== 'all') {
      posts = posts.filter(p => p.tags.includes(activeFilter));
    }

    // Ordena pela data (timestamp = número de milissegundos desde 1970) — maior = mais novo
    posts.sort((a, b) => b.timestamp - a.timestamp);

    if (posts.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">🔮</div>
          <div class="empty-state-title">Nenhum post encontrado</div>
          <p>
            ${App.currentUser
              ? 'Seja o primeiro a publicar nesta seção!'
              : 'Faça login e seja o primeiro a publicar aqui!'}
          </p>
          ${App.currentUser
            ? `<button class="btn btn-primary" style="margin:1rem auto;display:flex" onclick="openNewPostModal('${type}')">+ Criar Post</button>`
            : `<button class="btn btn-outline" style="margin:1rem auto;display:flex" onclick="openAuthModal()">Entrar</button>`
          }
        </div>`;
      return;
    }

    // Converte cada post em HTML de card e insere na grade
    grid.innerHTML = posts.map(p => buildPostCard(p)).join('');
  }

  // Recebe um objeto de post e retorna o HTML completo do card como texto
  function buildPostCard(post) {
    const isOwner = App.currentUser && App.currentUser.id === post.authorId;

    // Converte cada tag em um span colorido (ex: <span class="tag tag-pve">PVE</span>)
    const tagsHtml = post.tags.map(t =>
      `<span class="tag tag-${t.toLowerCase().replace(/[^a-z]/g,'')}">${t}</span>`
    ).join('');

    // Inclui o botão de deletar apenas se o usuário logado for o autor do post
    const deleteBtn = isOwner
      ? `<button class="post-card-delete" onclick="deletePost('${post.id}', event)" title="Deletar post">✕</button>`
      : '';

    return `
      <div class="post-card">
        ${deleteBtn}
        <div class="post-card-thumb">${post.emoji}</div>
        <div class="post-card-body">
          <div class="post-card-tags">${tagsHtml}</div>
          <h3 class="post-card-title">${escapeHtml(post.title)}</h3>
          <p class="post-card-desc">${escapeHtml(post.desc)}</p>
          <div class="post-card-footer">
            <div class="post-card-author">
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
  // FILTROS NAS PÁGINAS INTERNAS
  // Chamada quando o usuário clica em um botão de filtro (PVE, EVENTO, etc.).
  // Salva o filtro escolhido e recarrega os posts filtrados.
  // ===========================================================
  function filterPosts(type, filterValue, btnEl) {
    // Guarda qual filtro está ativo agora para usar na próxima renderização
    App.currentFilter[type] = filterValue;

    // Remove o destaque de todos os botões de filtro e coloca apenas no clicado
    const parent = btnEl.closest('.page-filters');
    parent.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');

    // Recarrega os posts na tela já aplicando o novo filtro
    renderPage(type);
  }

  // ===========================================================
  // BUSCA NA NAVBAR
  // Executada cada vez que o usuário digita no campo de busca.
  // Procura o texto em títulos, descrições e tags de todos os posts.
  // Se encontrar algo, navega para a página do primeiro resultado.
  // ===========================================================
  function handleSearch() {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    if (query.length < 2) return;

    // Procura o texto em título, descrição e tags de todos os posts
    const all = getPosts().filter(p =>
      p.title.toLowerCase().includes(query) ||
      p.desc.toLowerCase().includes(query) ||
      p.tags.some(t => t.toLowerCase().includes(query))
    );

    if (all.length === 0) {
      showToast(`Nenhum resultado para "${query}"`, 'info');
      return;
    }

    // Navega para a seção onde o primeiro resultado foi encontrado
    const firstType = all[0].type;
    showPage(firstType);
    showToast(`${all.length} resultado(s) encontrado(s)!`, 'success');
  }

  // ===========================================================
  // TOASTS / NOTIFICAÇÕES FLUTUANTES
  // Exibe uma mensagem colorida no canto inferior da tela por 3 segundos.
  // Tipos disponíveis: 'success' (verde), 'error' (vermelho), 'info' (laranja magma).
  // ===========================================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast');
    const item = document.createElement('div');
    item.className = `toast-item toast-${type}`;
    item.textContent = message;
    container.appendChild(item);

    // Aguarda 3 segundos, inicia a animação de saída, depois remove o elemento da tela
    setTimeout(() => {
      item.style.animation = 'toastOut .3s ease forwards';
      setTimeout(() => item.remove(), 300);
    }, 3000);
  }

  // ===========================================================
  // SEGURANÇA – ESCAPE DE HTML
  // Converte caracteres especiais de HTML (como < e >) em versões seguras.
  // Isso evita que um usuário mal-intencionado injete código HTML/JavaScript
  // no site através dos campos de texto (ataque chamado XSS).
  // ===========================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  // ===========================================================
  // INICIALIZAÇÃO DO APP
  // DOMContentLoaded dispara quando o navegador termina de carregar
  // todo o HTML. Só então o JavaScript começa a funcionar,
  // garantindo que todos os elementos já existem na página.
  // ===========================================================
  document.addEventListener('DOMContentLoaded', () => {
    // Passo 1: Cria os posts de exemplo se o site está sendo aberto pela primeira vez
    seedDefaultPosts();

    // Passo 2: Se o usuário já estava logado (mesma sessão), mantém ele logado
    restoreSession();

    // Passo 3: Preenche as três colunas da home com os posts salvos
    renderHome();

    // Passo 4: Ao pressionar ESC, fecha modais e o menu mobile
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal('authModal');
        closeModal('postModal');
        closeMobileMenu();
      }
    });

    // Fecha o menu mobile ao clicar em qualquer área fora da navbar
    document.addEventListener('click', e => {
      if (!document.getElementById('navbar').contains(e.target)) {
        closeMobileMenu();
      }
    });

    // Passo 5: Ao pressionar Enter nos campos de senha, envia o formulário automaticamente
    document.getElementById('loginPassword').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('regConfirm').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleRegister();
    });
  });