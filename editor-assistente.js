/* =============================================================
   ASSISTENTE DE CRIAÇÃO DE POSTS (24/10/2026)
   -------------------------------------------------------------
   Substitui o editor "estilo Word" por um passo a passo, como o
   criador de builds do OP.GG:

     1. Básico   → título, resumo, tags, capa e vídeo
     2. Conteúdo → blocos prontos (texto, ficha, lista em ordem)
     3. Prévia   → o post exatamente como vai aparecer, e Publicar

   O rascunho é salvo sozinho no navegador enquanto você escreve.
   As imagens enviadas são diminuídas automaticamente (o navegador
   só guarda uns 5 MB no total).

   COMO DESLIGAR (voltar ao editor antigo):
   apague no index.html a linha
     <script src="editor-assistente.js"></script>
   Nada mais precisa mudar: este arquivo só "substitui" as funções
   startInlineCreate e startInlineEdit do backend.js.
   ============================================================= */

(function () {
  // Carrega o CSS do assistente (assim basta UMA linha no index.html)
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'editor-assistente.css';
  document.head.appendChild(css);

  // Cria a "página" do assistente dentro do #app
  const page = document.createElement('div');
  page.className = 'page';
  page.id = 'page-editor';
  document.getElementById('app').appendChild(page);

  // Prints oficiais da Steam que podem ser usados como capa.
  // Se algum arquivo não existir, ele some sozinho da lista.
  const BIBLIOTECA_CAPAS = [
    ...Array.from({ length: 15 }, (_, i) => `imagens/steam/ss${String(i + 1).padStart(2, '0')}.jpg`),
    'imagens/steam/library_hero.jpg',
  ];

  const NOMES = { builds: 'build', guias: 'guia', novidades: 'notícia' };

  // Tipos de bloco que o autor pode adicionar
  const TIPOS_BLOCO = {
    texto: { rotulo: 'Texto',            dica: 'Parágrafos normais. Linha em branco separa os parágrafos. Para pôr uma imagem no meio do texto, clique onde ela deve ficar e depois em "Localize no texto aqui" na imagem.' },
    ficha: { rotulo: 'Ficha',            dica: 'Pares "nome: valor". Vira uma tabela, boa para informações rápidas.' },
    lista: { rotulo: 'Lista em ordem',   dica: 'Itens numerados. Bom para ordem de habilidades ou passo a passo.' },
    itens: { rotulo: 'Itens',            dica: 'Clique no quadrado para pôr a imagem do item (ou arraste / Ctrl+V) e escreva o nome ao lado.' },
  };

  /*
    ESPAÇOS DO BLOCO "ITENS" (24/10/2026, pedido do ronan)
    - total:    quantos espaços existem guardados no post
    - visiveis: quantos aparecem para preencher e no post publicado
    Orbes têm 6 espaços, mas só 5 aparecem: o 6º orbe ainda vai
    chegar no jogo. Quando chegar, é só trocar "visiveis: 5" por
    "visiveis: 6" aqui embaixo — nada mais precisa mudar.
  */
  const GRUPOS_ITENS = [
    { chave: 'trofeus',   rotulo: 'Troféus',   singular: 'troféu',   total: 3, visiveis: 3 },
    { chave: 'artefatos', rotulo: 'Artefatos', singular: 'artefato', total: 3, visiveis: 3 },
    { chave: 'orbes',     rotulo: 'Orbes',     singular: 'orbe',     total: 6, visiveis: 5 },
  ];
  const NOME_BLOCO_ITENS = 'Artefatos, troféus e orbes';

  // Modelos que já vêm preenchidos ao criar um post novo
  // (24/10/2026: "Atributos" saiu porque o jogo não tem atributos)
  const MODELOS = {
    builds: [
      ['texto', 'Visão geral'],
      ['lista', 'Ordem das habilidades'],
      ['itens', NOME_BLOCO_ITENS],
      ['texto', 'Como jogar'],
    ],
    guias: [
      ['texto', 'Introdução'],
      ['lista', 'Passo a passo'],
      ['texto', 'Dicas'],
    ],
    novidades: [
      ['texto', 'Texto da notícia'],
    ],
  };

  // Estado do assistente (tudo que o autor está preenchendo)
  let E = null;
  let timerRascunho = null;

  const novoId = () => 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = s => escapeHtml(String(s ?? ''));

  function blocoVazio(kind, name) {
    return {
      id: novoId(), kind, name,
      text: '',
      rows: kind === 'ficha' ? [{ k: '', v: '' }, { k: '', v: '' }, { k: '', v: '' }] : [],
      items: kind === 'lista' ? ['', '', ''] : [],
      itens: kind === 'itens' ? itensVazios() : undefined,
      images: [],
    };
  }

  /* Cria os espaços vazios do bloco "Itens": { trofeus: [{img, nome}, ...], ... } */
  function itensVazios(salvos) {
    const r = {};
    GRUPOS_ITENS.forEach(g => {
      r[g.chave] = Array.from({ length: g.total }, (_, n) => {
        const s = salvos?.[g.chave]?.[n];
        return { img: s?.img || null, nome: s?.nome || '' };
      });
    });
    return r;
  }

  // Diz se um espaço de item tem alguma coisa preenchida
  const slotPreenchido = s => !!(s.img || s.nome.trim());

  // Só aceita imagens enviadas (data:image) ou do próprio site (imagens/...)
  const imagemSegura = u => typeof u === 'string' && (/^data:image\//.test(u) || /^imagens\//.test(u));

  /* Converte uma seção salva de volta para bloco (para editar posts antigos) */
  function secaoParaBloco(s) {
    if (s.kind === 'itens' && s.itens) return { ...blocoVazio('itens', s.name), id: s.id, itens: itensVazios(s.itens) };
    if (s.kind === 'ficha' && Array.isArray(s.rows)) return { ...blocoVazio('ficha', s.name), id: s.id, rows: s.rows.map(r => ({ ...r })), images: [...(s.images || [])] };
    if (s.kind === 'lista' && Array.isArray(s.items)) return { ...blocoVazio('lista', s.name), id: s.id, items: [...s.items], images: [...(s.images || [])] };
    return { ...blocoVazio('texto', s.name), id: s.id || novoId(), text: s.content || '', images: [...(s.images || [])] };
  }

  /* Converte um bloco em seção no formato que o backend.js já sabe mostrar */
  function blocoParaSecao(b, i) {
    let content = b.text.trim();
    if (b.kind === 'ficha') {
      content = b.rows.filter(r => r.k.trim() || r.v.trim())
        .map(r => `${r.k.trim() || '—'}: ${r.v.trim() || '—'}`).join('\n');
    }
    if (b.kind === 'lista') {
      content = b.items.map(t => t.trim()).filter(Boolean).map((t, n) => `${n + 1}. ${t}`).join('\n');
    }
    if (b.kind === 'itens') {
      // Texto reserva: se um dia este arquivo for desligado, o post
      // ainda mostra os nomes ("Troféus: A · B · C") em vez de sumir.
      content = GRUPOS_ITENS.map(g => {
        const nomes = b.itens[g.chave].slice(0, g.visiveis).filter(slotPreenchido)
          .map(s => s.nome.trim() || '(sem nome)');
        return nomes.length ? `${g.rotulo}: ${nomes.join(' · ')}` : '';
      }).filter(Boolean).join('\n');
    }
    return {
      id: b.id,
      name: b.name.trim() || `Seção ${i + 1}`,
      content,
      images: [...b.images],
      kind: b.kind,
      rows: b.kind === 'ficha' ? b.rows.filter(r => r.k.trim() || r.v.trim()) : undefined,
      items: b.kind === 'lista' ? b.items.map(t => t.trim()).filter(Boolean) : undefined,
      itens: b.kind === 'itens' ? itensVazios(b.itens) : undefined,
    };
  }

  /*
    Rascunhos feitos antes de 24/10/2026 ainda têm o bloco "Atributos"
    e a ficha antiga de itens. Aqui tiramos o "Atributos" e trocamos a
    ficha antiga pelo bloco novo — só se estiverem vazios, para não
    apagar nada que o autor já escreveu.
  */
  function atualizarRascunhoAntigo(r) {
    if (r.versao >= 2) return r;
    const vazio = b => !(b.text || '').trim() && !(b.images || []).length
      && !(b.rows || []).some(x => x.k || x.v) && !(b.items || []).some(Boolean);
    r.blocks = r.blocks
      .filter(b => !(b.kind === 'ficha' && b.name === 'Atributos' && vazio(b)))
      .map(b => (b.kind === 'ficha' && b.name === NOME_BLOCO_ITENS && vazio(b))
        ? { ...blocoVazio('itens', NOME_BLOCO_ITENS), id: b.id } : b);
    r.versao = 2;
    return r;
  }

  /* ---------- Abrir o assistente ---------- */

  window.startInlineCreate = function (type) {
    if (!App.currentUser) { openAuthModal(); showToast('Faça login para criar um post!', 'info'); return; }
    if (type === 'novidades' && !App.currentUser.isAdmin) {
      showToast('A seção de Notícias é gerenciada pela equipe Drakbuilder.', 'info'); return;
    }
    let salvo = null;
    try { salvo = JSON.parse(localStorage.getItem('drk_rascunho_' + type) || 'null'); } catch (e) {}

    E = salvo && salvo.type === type ? atualizarRascunhoAntigo(salvo) : {
      type, editingId: null, step: 1, versao: 2,
      title: '', desc: '', tags: [], cover: null, yt: '',
      blocks: MODELOS[type].map(([k, n]) => blocoVazio(k, n)),
    };
    E.restaurado = !!salvo;
    App.inlineEditing = false;
    render();
    showPage('editor');
  };

  window.startInlineEdit = function (postId) {
    const post = getPosts().find(p => p.id === postId);
    if (!post || !App.currentUser) return;
    const dono = App.currentUser.id === post.authorId;
    if (!dono && !(App.currentUser.isAdmin && post.type === 'novidades')) {
      showToast('Você não pode editar este post.', 'error'); return;
    }
    E = {
      type: post.type, editingId: post.id, step: 2,
      title: post.title || '', desc: post.desc || '', tags: [...(post.tags || [])],
      cover: post.cardImage || null, yt: post.youtubeUrl || '',
      blocks: (post.sections || []).map(secaoParaBloco),
    };
    if (!E.blocks.length) E.blocks = [blocoVazio('texto', 'Texto')];
    App.inlineEditing = false;
    render();
    showPage('editor');
  };

  /* ---------- Rascunho automático ---------- */

  function salvarRascunho() {
    if (!E || E.editingId) return; // edição de post existente não usa rascunho
    clearTimeout(timerRascunho);
    timerRascunho = setTimeout(() => {
      const st = document.getElementById('ae-status');
      try {
        const { restaurado, ...dados } = E;
        localStorage.setItem('drk_rascunho_' + E.type, JSON.stringify(dados));
        if (st) st.textContent = 'Rascunho salvo';
      } catch (e) {
        if (st) st.textContent = 'Sem espaço para salvar o rascunho (imagens demais?)';
      }
    }, 500);
  }

  function apagarRascunho(type) {
    try { localStorage.removeItem('drk_rascunho_' + type); } catch (e) {}
  }

  /* ---------- Imagens: diminui antes de guardar ---------- */
  /*
    Uma print de 1920x1080 em PNG pode ter 3 MB. Aqui redesenhamos a
    imagem num <canvas> com no máximo 1280px de largura e salvamos em
    JPEG — fica com uns 150 KB e quase igual na tela.
  */
  // "formato": prints viram JPEG (leve); ícones de itens viram PNG para
  // manter o fundo transparente.
  function diminuirImagem(file, larguraMax = 1280, formato = 'image/jpeg') {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) { reject(new Error('não é imagem')); return; }
      const leitor = new FileReader();
      leitor.onload = () => {
        const img = new Image();
        img.onload = () => {
          const escala = Math.min(1, larguraMax / img.width);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * escala);
          c.height = Math.round(img.height * escala);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(formato, 0.82));
        };
        img.onerror = reject;
        img.src = leitor.result;
      };
      leitor.onerror = reject;
      leitor.readAsDataURL(file);
    });
  }

  async function adicionarImagens(arquivos, destino) {
    const lista = [...arquivos].filter(f => f.type.startsWith('image/'));
    if (!lista.length) return;
    for (const f of lista) {
      try {
        const url = await diminuirImagem(f);
        if (destino === 'capa') E.cover = url;
        else { const b = E.blocks.find(x => x.id === destino); if (b) b.images.push(url); }
      } catch (e) { showToast('Não consegui ler uma das imagens.', 'error'); }
    }
    render(); salvarRascunho();
  }

  /* Imagem de um espaço de item: diminuída para 160px (ícone), em PNG */
  async function imagemDoSlot(arquivos, id, grupo, n) {
    const f = [...arquivos].find(x => x.type.startsWith('image/'));
    if (!f) return;
    try {
      const b = E.blocks.find(x => x.id === id);
      if (b) b.itens[grupo][n].img = await diminuirImagem(f, 160, 'image/png');
    } catch (e) { showToast('Não consegui ler essa imagem.', 'error'); }
    render(); salvarRascunho();
  }

  /* ---------- Desenho da tela ---------- */

  function render() {
    if (!E) return;
    const nome = NOMES[E.type];
    const passos = ['Básico', 'Conteúdo', 'Prévia'];
    page.innerHTML = `
      <div class="ae">
        <header class="ae-head">
          <div>
            <button class="detail-back ae-back" onclick="aeCancelar()">← Cancelar</button>
            <h1 class="ae-title">${E.editingId ? 'Editar ' + nome : 'Nova ' + nome}</h1>
          </div>
          <ol class="ae-steps">
            ${passos.map((p, i) => `
              <li><button class="${E.step === i + 1 ? 'on' : ''} ${E.step > i + 1 ? 'done' : ''}"
                onclick="aeIrPara(${i + 1})"><span>${i + 1}</span>${p}</button></li>`).join('')}
          </ol>
        </header>
        ${E.restaurado && E.step === 1 ? `
          <div class="ae-aviso">Continuando o rascunho que você deixou.
            <button onclick="aeDescartarRascunho()">Começar do zero</button></div>` : ''}
        <div class="ae-body">${E.step === 1 ? passo1() : E.step === 2 ? passo2() : passo3()}</div>
        <footer class="ae-foot">
          <span id="ae-status" class="ae-status">${E.editingId ? '' : 'O rascunho é salvo sozinho'}</span>
          <div class="ae-foot-btns">
            ${E.step > 1 ? `<button class="btn btn-outline" onclick="aeIrPara(${E.step - 1})">Voltar</button>` : ''}
            ${E.step < 3
              ? `<button class="btn btn-primary" onclick="aeIrPara(${E.step + 1})">${E.step === 1 ? 'Próximo: conteúdo' : 'Ver prévia'}</button>`
              : `<button class="btn btn-primary" onclick="aePublicar()">${E.editingId ? 'Salvar alterações' : 'Publicar'}</button>`}
          </div>
        </footer>
      </div>`;
    if (E.step === 3) montarPrevia();
  }

  function passo1() {
    const ytId = extractYouTubeId(E.yt);
    const comVideo = E.type !== 'novidades';
    return `
      <div class="ae-form">
        <label class="ae-field">
          <span class="ae-label">Título</span>
          <input class="input" maxlength="80" value="${esc(E.title)}"
            placeholder="${E.type === 'builds' ? 'Ex.: Paladina de Escudo – Muralha Viva' : 'Ex.: Como farmar ouro no começo'}"
            oninput="aeSet('title', this.value)">
        </label>
        <label class="ae-field">
          <span class="ae-label">Resumo <small>aparece no card e no topo do post</small></span>
          <textarea class="input" rows="2" maxlength="220"
            placeholder="Uma ou duas frases: para que serve e para quem é."
            oninput="aeSet('desc', this.value)">${esc(E.desc)}</textarea>
        </label>
        <div class="ae-field">
          <span class="ae-label">Tags</span>
          <div class="ae-chips">
            ${TAG_OPTIONS[E.type].map(t => `
              <button type="button" class="filter-btn ${E.tags.includes(t) ? 'active' : ''}"
                onclick="aeTag('${t}')">${t}</button>`).join('')}
          </div>
        </div>
        <div class="ae-field">
          <span class="ae-label">Capa <small>escolha um print do jogo ou envie o seu</small></span>
          <div class="ae-covers">
            <label class="ae-cover ae-upload ${E.cover && E.cover.startsWith('data:') ? 'on' : ''}">
              ${E.cover && E.cover.startsWith('data:') ? `<img src="${E.cover}" alt="">` : '<span>Enviar imagem<br><small>ou Ctrl+V</small></span>'}
              <input type="file" accept="image/*" hidden onchange="aeArquivos(this.files,'capa')">
            </label>
            ${BIBLIOTECA_CAPAS.map(src => `
              <button type="button" class="ae-cover ${E.cover === src ? 'on' : ''}" onclick="aeSet('cover','${src}',true)">
                <img src="${src}" alt="" loading="lazy" onerror="this.parentElement.remove()">
              </button>`).join('')}
          </div>
        </div>
        ${comVideo ? `
        <label class="ae-field">
          <span class="ae-label">Vídeo do YouTube <small>opcional, mas é o que mais convence</small></span>
          <input class="input" value="${esc(E.yt)}" placeholder="https://www.youtube.com/watch?v=..."
            oninput="aeSet('yt', this.value); aeYtPreview(this.value)">
          <div id="ae-yt">${ytPreviewHtml(ytId, E.yt)}</div>
        </label>` : ''}
      </div>`;
  }

  function ytPreviewHtml(id, url) {
    if (!url.trim()) return '';
    if (!id) return '<p class="ae-erro">Esse link não parece ser de um vídeo do YouTube.</p>';
    return `<img class="ae-yt-thumb" src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="Prévia do vídeo">`;
  }

  function passo2() {
    return `
      <p class="ae-intro">Cada bloco vira uma seção do post. Preencha só o que fizer sentido;
        blocos vazios não aparecem. Para colar uma print, clique no bloco e aperte <kbd>Ctrl+V</kbd>.</p>
      <div class="ae-blocks">
        ${E.blocks.map((b, i) => blocoHtml(b, i)).join('')}
      </div>
      <div class="ae-add">
        <span>Adicionar bloco:</span>
        ${Object.entries(TIPOS_BLOCO)
          // O bloco "Itens" só existe em builds, e só um por post
          .filter(([k]) => k !== 'itens' || (E.type === 'builds' && !E.blocks.some(b => b.kind === 'itens')))
          .map(([k, t]) => `
          <button class="btn btn-outline" onclick="aeAddBloco('${k}')">+ ${t.rotulo}</button>`).join('')}
      </div>`;
  }

  function blocoHtml(b, i) {
    const t = TIPOS_BLOCO[b.kind];
    let corpo = '';
    if (b.kind === 'texto') {
      corpo = `<textarea class="input ae-text" id="ae-txt-${b.id}" rows="5" placeholder="Escreva aqui..."
        oninput="aeBloco('${b.id}','text',this.value)">${esc(b.text)}</textarea>`;
    }
    if (b.kind === 'ficha') {
      corpo = `<div class="ae-rows">
        ${b.rows.map((r, n) => `
          <div class="ae-row">
            <input class="input" placeholder="${['Ex.: Dificuldade', 'Ex.: Função', 'Ex.: Versão do jogo'][n % 3]}" value="${esc(r.k)}"
              oninput="aeRow('${b.id}',${n},'k',this.value)">
            <input class="input" placeholder="${['Média', 'Tanque', '1.0'][n % 3]}" value="${esc(r.v)}"
              oninput="aeRow('${b.id}',${n},'v',this.value)">
            <button class="ae-x" title="Remover linha" onclick="aeDelItem('${b.id}',${n})">✕</button>
          </div>`).join('')}
        <button class="ae-mini" onclick="aeAddItem('${b.id}')">+ linha</button>
      </div>`;
    }
    if (b.kind === 'lista') {
      corpo = `<div class="ae-rows">
        ${b.items.map((it, n) => `
          <div class="ae-row ae-row-list">
            <span class="ae-num">${n + 1}</span>
            <input class="input" placeholder="${n === 0 ? 'Ex.: Golpe de Escudo' : ''}" value="${esc(it)}"
              oninput="aeItem('${b.id}',${n},this.value)">
            <button class="ae-x" title="Remover item" onclick="aeDelItem('${b.id}',${n})">✕</button>
          </div>`).join('')}
        <button class="ae-mini" onclick="aeAddItem('${b.id}')">+ item</button>
      </div>`;
    }
    if (b.kind === 'itens') {
      // Um quadrado de imagem + o nome ao lado, para cada espaço.
      // Espaços além de "visiveis" (o 6º orbe) existem, mas ficam escondidos.
      corpo = `<div class="ae-eq">
        ${GRUPOS_ITENS.map(g => `
          <div class="ae-eq-grupo">
            <span class="ae-eq-titulo">${g.rotulo}</span>
            <div class="ae-eq-lista">
              ${b.itens[g.chave].map((s, n) => `
                <div class="ae-slot" ${n >= g.visiveis ? 'hidden' : ''}
                  onfocusin="aeSlotFoco('${b.id}','${g.chave}',${n})" onclick="aeSlotFoco('${b.id}','${g.chave}',${n})">
                  <label class="ae-slot-img ${imagemSegura(s.img) ? 'on' : ''}" title="Escolher imagem"
                    data-slot="${b.id}|${g.chave}|${n}">
                    ${imagemSegura(s.img) ? `<img src="${s.img}" alt="">` : '+'}
                    <input type="file" accept="image/*" hidden onchange="aeSlotImg('${b.id}','${g.chave}',${n},this.files)">
                  </label>
                  <input class="input" placeholder="Nome do ${g.singular} ${n + 1}" value="${esc(s.nome)}"
                    oninput="aeSlotNome('${b.id}','${g.chave}',${n},this.value)">
                  <button class="ae-x" title="Limpar" onclick="aeSlotLimpar('${b.id}','${g.chave}',${n})">✕</button>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>`;
    }
    return `
      <section class="ae-block" data-id="${b.id}" tabindex="-1" onfocusin="aeFoco('${b.id}')" onclick="aeFoco('${b.id}')">
        <div class="ae-block-head">
          <span class="ae-kind">${t.rotulo}</span>
          <input class="ae-block-name" value="${esc(b.name)}" placeholder="Nome da seção"
            oninput="aeBloco('${b.id}','name',this.value)">
          <div class="ae-block-tools">
            <button title="Subir" ${i === 0 ? 'disabled' : ''} onclick="aeMover('${b.id}',-1)">↑</button>
            <button title="Descer" ${i === E.blocks.length - 1 ? 'disabled' : ''} onclick="aeMover('${b.id}',1)">↓</button>
            <button title="Remover bloco" onclick="aeDelBloco('${b.id}')">Remover</button>
          </div>
        </div>
        <p class="ae-hint">${t.dica}</p>
        ${corpo}
        ${b.kind === 'itens' ? '' : `<div class="ae-imgs">
          ${b.images.map((src, n) => `
            <div class="ae-img"><img src="${src}" alt="">
              <span title="Escreva [imagem ${n + 1}] numa linha do texto para mostrar esta imagem ali" style="position:absolute;left:4px;top:4px;background:rgba(0,0,0,.75);color:#fff;font-size:.7rem;padding:0 .35rem;border-radius:3px">${n + 1}</span>
              <button title="Remover imagem" onclick="aeDelImg('${b.id}',${n})">✕</button>
              ${b.kind === 'texto' ? `<button title="Colocar esta imagem no texto, onde está o cursor" style="top:auto;bottom:3px;left:3px;right:3px;width:auto;height:auto;padding:.1rem .3rem;font-size:.66rem;line-height:1.2;white-space:normal" onclick="aeImgNoTexto('${b.id}',${n})">Localize no texto aqui</button>` : ''}</div>`).join('')}
          <label class="ae-img-add">+ Imagens
            <input type="file" accept="image/*" multiple hidden onchange="aeArquivos(this.files,'${b.id}')">
          </label>
        </div>`}
      </section>`;
  }

  function passo3() {
    return `<div class="ae-preview" id="ae-preview"></div>`;
  }

  /* Monta o post temporário e usa o MESMO código da página de post para mostrar */
  function montarPostRascunho() {
    const existente = E.editingId ? getPosts().find(p => p.id === E.editingId) : null;
    return {
      ...(existente || {}),
      id: E.editingId || 'rascunho',
      type: E.type,
      title: E.title.trim() || 'Sem título',
      desc: E.desc.trim(),
      tags: [...E.tags],
      emoji: existente?.emoji || '',
      author: existente?.author || App.currentUser.name,
      authorId: existente?.authorId || App.currentUser.id,
      date: existente?.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
      cardImage: E.cover,
      youtubeUrl: E.type !== 'novidades' && E.yt.trim() ? E.yt.trim() : null,
      youtubeEmbeddable: existente && existente.youtubeUrl === E.yt.trim() ? existente.youtubeEmbeddable : null,
      sections: E.blocks.map(blocoParaSecao).filter(s => s.content || s.images.length),
    };
  }

  function montarPrevia() {
    const alvo = document.getElementById('ae-preview');
    const detalhe = document.getElementById('page-detail');
    const antes = detalhe.innerHTML;
    // Passa pela mesma limpeza de segurança que os posts salvos (backend.js)
    const rascunho = montarPostRascunho();
    renderPostDetail(sanitizePost({ ...rascunho, id: 'rascunho' }) || rascunho);
    alvo.innerHTML = detalhe.innerHTML;
    detalhe.innerHTML = antes;
  }

  /* ---------- Ações chamadas pelos botões ---------- */

  window.aeSet = (campo, valor, redesenhar) => { E[campo] = valor; salvarRascunho(); if (redesenhar) render(); };
  window.aeTag = tag => { E.tags = E.tags.includes(tag) ? E.tags.filter(t => t !== tag) : [...E.tags, tag]; render(); salvarRascunho(); };
  window.aeYtPreview = url => { const el = document.getElementById('ae-yt'); if (el) el.innerHTML = ytPreviewHtml(extractYouTubeId(url), url); };
  window.aeArquivos = (files, destino) => adicionarImagens(files, destino);
  const achar = id => E.blocks.find(b => b.id === id);
  window.aeBloco = (id, campo, valor) => { achar(id)[campo] = valor; salvarRascunho(); };
  window.aeRow = (id, n, campo, valor) => { achar(id).rows[n][campo] = valor; salvarRascunho(); };
  window.aeItem = (id, n, valor) => { achar(id).items[n] = valor; salvarRascunho(); };
  window.aeAddItem = id => {
    const b = achar(id);
    if (b.kind === 'ficha') b.rows.push({ k: '', v: '' }); else b.items.push('');
    render(); salvarRascunho();
    const inputs = page.querySelectorAll(`.ae-block[data-id="${id}"] .ae-row input`);
    if (inputs.length) inputs[b.kind === 'ficha' ? inputs.length - 2 : inputs.length - 1].focus();
  };
  window.aeDelItem = (id, n) => { const b = achar(id); (b.kind === 'ficha' ? b.rows : b.items).splice(n, 1); render(); salvarRascunho(); };
  // Põe a linha [imagem N] no texto do bloco, onde o cursor estava (ou no fim).
  // O site mostra a imagem nesse ponto; a linha pode ser movida à vontade.
  window.aeImgNoTexto = (id, n) => {
    const b = achar(id);
    if (!b || typeof b.text !== 'string') return;
    const ta = document.getElementById('ae-txt-' + id);
    const pos = ta && typeof ta.selectionStart === 'number' ? ta.selectionStart : b.text.length;
    const antes = b.text.slice(0, pos).replace(/[ \t]*$/, '');
    const depois = b.text.slice(pos).replace(/^[ \t]*/, '');
    const marca = `[imagem ${n + 1}]`;
    b.text = antes + (antes && !antes.endsWith('\n') ? '\n' : '') + marca + (depois && !depois.startsWith('\n') ? '\n' : '') + depois;
    if (ta) { ta.value = b.text; const fim = (antes + (antes && !antes.endsWith('\n') ? '\n' : '') + marca).length; ta.focus(); ta.setSelectionRange(fim, fim); }
    salvarRascunho();
    showToast(`Imagem ${n + 1} colocada no texto.`, 'info');
  };

  // Remove a imagem e acerta as marcas [imagem N] do texto (a removida some, as seguintes descem 1)
  window.aeDelImg = (id, n) => {
    const b = achar(id);
    b.images.splice(n, 1);
    if (typeof b.text === 'string') {
      b.text = b.text.split('\n').map(l => {
        const m = l.trim().match(/^\[imagem\s+(\d{1,2})\]$/i);
        if (!m) return l;
        const k = Number(m[1]);
        return k === n + 1 ? null : k > n + 1 ? `[imagem ${k - 1}]` : l;
      }).filter(l => l !== null).join('\n');
    }
    render(); salvarRascunho();
  };
  // Ações dos espaços de item (imagem + nome)
  window.aeSlotFoco = (id, grupo, n) => { E.focado = id; E.slotFocado = { id, grupo, n }; };
  window.aeSlotImg = (id, grupo, n, files) => imagemDoSlot(files, id, grupo, n);
  window.aeSlotNome = (id, grupo, n, valor) => { achar(id).itens[grupo][n].nome = valor; salvarRascunho(); };
  window.aeSlotLimpar = (id, grupo, n) => { achar(id).itens[grupo][n] = { img: null, nome: '' }; render(); salvarRascunho(); };

  window.aeAddBloco = kind => {
    const b = blocoVazio(kind, kind === 'itens' ? NOME_BLOCO_ITENS : TIPOS_BLOCO[kind].rotulo);
    E.blocks.push(b); render(); salvarRascunho();
    const el = page.querySelector(`.ae-block[data-id="${b.id}"] .ae-block-name`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.select(); }
  };
  window.aeDelBloco = id => {
    const b = achar(id);
    const temConteudo = b.text.trim() || b.images.length || b.rows.some(r => r.k || r.v) || b.items.some(Boolean)
      || (b.kind === 'itens' && GRUPOS_ITENS.some(g => b.itens[g.chave].some(slotPreenchido)));
    if (temConteudo && !confirm(`Remover o bloco "${b.name || 'sem nome'}"?`)) return;
    E.blocks = E.blocks.filter(x => x.id !== id); render(); salvarRascunho();
  };
  window.aeMover = (id, dir) => {
    const i = E.blocks.findIndex(b => b.id === id), j = i + dir;
    if (j < 0 || j >= E.blocks.length) return;
    [E.blocks[i], E.blocks[j]] = [E.blocks[j], E.blocks[i]];
    render(); salvarRascunho();
  };
  window.aeFoco = id => { E.focado = id; };

  window.aeIrPara = passo => {
    if (passo > 1 && (E.title.trim().length < 5 || !E.desc.trim())) {
      E.step = 1; render();
      showToast(E.title.trim().length < 5 ? 'Dê um título com pelo menos 5 letras.' : 'Escreva um resumo curto.', 'error');
      return;
    }
    E.step = passo; E.restaurado = false; render(); salvarRascunho();
    window.scrollTo({ top: 0 });
  };

  window.aeDescartarRascunho = () => {
    if (!confirm('Apagar o rascunho e começar do zero?')) return;
    apagarRascunho(E.type);
    const t = E.type; E = null; window.startInlineCreate(t);
  };

  window.aeCancelar = () => {
    const t = E.type, id = E.editingId;
    if (id) { if (!confirm('Sair sem salvar as alterações?')) return; E = null; showPostDetail(id); return; }
    E = null; showPage(t);
    showToast('O rascunho continua salvo. Ele volta quando você criar de novo.', 'info');
  };

  window.aePublicar = () => {
    const rascunho = montarPostRascunho();
    const posts = getPosts();
    let salvo;
    if (E.editingId) {
      const idx = posts.findIndex(p => p.id === E.editingId);
      if (idx === -1) { showToast('Post não encontrado!', 'error'); return; }
      posts[idx] = rascunho; salvo = rascunho;
    } else {
      salvo = { ...rascunho, id: 'post-' + Date.now(), timestamp: Date.now() };
      posts.unshift(salvo);
    }
    try { savePosts(posts); }
    catch (e) { showToast('O navegador ficou sem espaço. Tire algumas imagens e tente de novo.', 'error'); return; }

    if (!E.editingId) {
      apagarRascunho(E.type);
      const tipo = { builds: 'Build', guias: 'Guia' }[salvo.type] || 'Post';
      getFollowers(App.currentUser.id).forEach(seguidor => pushNotification(seguidor, {
        type: 'new_post', fromUserId: App.currentUser.id, fromUserName: App.currentUser.name,
        postId: salvo.id, postTitle: salvo.title, postType: salvo.type, typeLabel: tipo, timestamp: Date.now(),
      }));
      renderNotificationBell();
    }
    showToast(E.editingId ? 'Post atualizado!' : 'Post publicado!', 'success');
    E = null;
    renderHome(); renderPage(salvo.type); renderMyPosts();
    showPostDetail(salvo.id);
  };

  /* Ctrl+V com imagem: vai para o bloco clicado por último (ou para a capa no passo 1) */
  document.addEventListener('paste', ev => {
    if (!E || !page.classList.contains('active')) return;
    const arquivos = [...(ev.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!arquivos.length) return;
    ev.preventDefault();
    // Clicou num espaço de item por último? A imagem vai para ele.
    const sf = E.slotFocado;
    if (E.step === 2 && sf && sf.id === E.focado && achar(sf.id)) { imagemDoSlot(arquivos, sf.id, sf.grupo, sf.n); return; }
    const destino = E.step === 1 ? 'capa' : (E.focado && achar(E.focado) ? E.focado : E.blocks[E.blocks.length - 1]?.id);
    if (destino && achar(destino)?.kind === 'itens') { showToast('Clique no espaço do item antes de colar a imagem.', 'info'); return; }
    if (destino) adicionarImagens(arquivos, destino);
  });

  /* Arrastar imagens para dentro de um bloco */
  page.addEventListener('dragover', ev => { if (ev.target.closest('.ae-block, .ae-upload')) ev.preventDefault(); });
  page.addEventListener('drop', ev => {
    if (!ev.dataTransfer?.files?.length) return;
    // Soltou em cima de um espaço de item? A imagem vai para ele.
    const slot = ev.target.closest('.ae-slot-img');
    if (slot) {
      ev.preventDefault();
      const [id, grupo, n] = slot.dataset.slot.split('|');
      imagemDoSlot(ev.dataTransfer.files, id, grupo, Number(n));
      return;
    }
    const alvo = ev.target.closest('.ae-block, .ae-upload');
    if (!alvo) return;
    ev.preventDefault();
    if (achar(alvo.dataset.id)?.kind === 'itens') return; // fora de um espaço: ignora
    adicionarImagens(ev.dataTransfer.files, alvo.classList.contains('ae-upload') ? 'capa' : alvo.dataset.id);
  });

  /* ---------- Post publicado: itens como "imagem + nome" ---------- */
  /*
    A página do post é desenhada pelo renderPostDetail do backend.js,
    que só sabe mostrar texto. Aqui "embrulhamos" essa função: ela
    desenha tudo normalmente e, logo depois, trocamos o texto do bloco
    "Itens" por cartões em que a imagem e o nome formam uma peça só.
    Assim o backend.js não precisa ser alterado.
  */
  function itensHtml(sec) {
    return `<div class="eq">${GRUPOS_ITENS.map(g => {
      const cheios = (sec.itens[g.chave] || []).slice(0, g.visiveis).filter(s => s && slotPreenchido({ img: s.img, nome: s.nome || '' }));
      if (!cheios.length) return '';
      return `
        <div class="eq-grupo">
          <h3 class="eq-titulo">${g.rotulo}</h3>
          <div class="eq-lista">
            ${cheios.map(s => `
              <div class="eq-item">
                ${imagemSegura(s.img) ? `<img src="${s.img}" alt="">` : '<span class="eq-vazio"></span>'}
                <span class="eq-nome">${esc(s.nome) || '—'}</span>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  const renderPostDetailOriginal = window.renderPostDetail;
  window.renderPostDetail = function (post) {
    renderPostDetailOriginal(post);
    if (App.inlineEditing && App.editingPostId === post.id) return; // editor antigo: não mexe
    const detalhe = document.getElementById('page-detail');
    (post.sections || []).forEach(s => {
      if (s.kind !== 'itens' || !s.itens || !s.id) return;
      const alvo = detalhe.querySelector('#' + CSS.escape(s.id) + ' .detail-section-content');
      if (alvo) alvo.innerHTML = itensHtml(s);
    });
  };
})();
