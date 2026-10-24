import { useState, useEffect, useCallback, useRef } from "react";

const STEAM_PROXY = "https://api.allorigins.win/get?url=";
const STEAM_NEWS_URL = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=2454980&count=10&maxlength=3000&format=json`;
const APP_ID = "2454980";

const INTERVALS = [
  { label: "5 min", value: 300000 },
  { label: "15 min", value: 900000 },
  { label: "30 min", value: 1800000 },
  { label: "1 hora", value: 3600000 },
  { label: "6 horas", value: 21600000 },
];

const POST_STATUS = {
  pending: { label: "Pendente", color: "#e8c84a" },
  publishing: { label: "Publicando...", color: "#4ae8c8" },
  published: { label: "Publicado", color: "#00ff9d" },
  error: { label: "Erro", color: "#ff4d4d" },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function stripBBCode(text = "") {
  return text
    .replace(/\[h[1-3]\]/gi, "").replace(/\[\/h[1-3]\]/gi, "\n")
    .replace(/\[b\](.*?)\[\/b\]/gi, "$1")
    .replace(/\[i\](.*?)\[\/i\]/gi, "$1")
    .replace(/\[u\](.*?)\[\/u\]/gi, "$1")
    .replace(/\[url=.*?\](.*?)\[\/url\]/gi, "$1")
    .replace(/\[img\].*?\[\/img\]/gi, "")
    .replace(/\[list\]/gi, "").replace(/\[\/list\]/gi, "")
    .replace(/\[\*\]/gi, "• ")
    .replace(/\[.*?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDate(unix) {
  return new Date(unix * 1000).toLocaleString("pt-BR");
}

// ── main component ────────────────────────────────────────────────────────────

export default function DrakantosAgent() {
  const [posts, setPosts] = useState([]);
  const [seenGids, setSeenGids] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("drk_seen") || "[]")); }
    catch { return new Set(); }
  });
  const [running, setRunning] = useState(false);
  const [interval, setIntervalVal] = useState(1800000);
  const [countdown, setCountdown] = useState(null);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("posts");
  const [loading, setLoading] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [publishMode, setPublishMode] = useState("draft"); // draft | publish
  const [expandedId, setExpandedId] = useState(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    setLogs(p => [{ msg, type, time: new Date().toLocaleTimeString("pt-BR"), id: Date.now() }, ...p.slice(0, 99)]);
  }, []);

  const saveSeen = useCallback((set) => {
    try { localStorage.setItem("drk_seen", JSON.stringify([...set])); } catch {}
  }, []);

  // ── fetch steam news ───────────────────────────────────────────────────────
  const fetchSteamNews = useCallback(async () => {
    addLog("📡 Buscando novidades da Steam para Drakantos...", "info");
    const url = `${STEAM_PROXY}${encodeURIComponent(STEAM_NEWS_URL)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const outer = await res.json();
    const data = JSON.parse(outer.contents);
    return data?.appnews?.newsitems || [];
  }, []);

  // ── generate post via claude ───────────────────────────────────────────────
  const generatePost = useCallback(async (item) => {
    const clean = stripBBCode(item.contents);
    const prompt = `Você é o editor oficial do site de fãs do jogo Drakantos, um MMORPG free-to-play com estilo pixel art ambientado no mundo de Eldras.

Transforme o devlog/notícia abaixo em um post editorial completo em português brasileiro para o site.

TÍTULO ORIGINAL: ${item.title}
DATA: ${formatDate(item.date)}
CONTEÚDO ORIGINAL:
${clean.slice(0, 2000)}

Gere o post seguindo EXATAMENTE este formato:

TITULO: (título em português, impactante, máx 80 chars)
SUBTITULO: (subtítulo/chamada que complementa o título, máx 120 chars)
CATEGORIA: (uma das opções: Devlog | Patch Notes | Novidades | Beta | Evento | Sistema)
TEMPO_LEITURA: (estimativa ex: "3 min")
CORPO:
(Post completo em português. 4-6 parágrafos. Mencione sistemas específicos do jogo, heróis, mecânicas. Use linguagem entusiasmada mas jornalística. Adequada para fãs do jogo.)
TAGS: (6-8 tags separadas por vírgula, ex: Drakantos, MMORPG, Devlog, Pixel Art, ...)
RESUMO: (2 frases para o card de preview do post)`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const raw = data.content?.map(c => c.text || "").join("\n") || "";

    const extract = (key) => {
      const m = raw.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z_ÁÉÍÓÚ]+:|$)`, "s"));
      return m ? m[1].trim() : "";
    };

    return {
      id: item.gid,
      steamGid: item.gid,
      title: extract("TITULO") || item.title,
      subtitle: extract("SUBTITULO"),
      category: extract("CATEGORIA") || "Novidades",
      readTime: extract("TEMPO_LEITURA") || "3 min",
      body: extract("CORPO") || clean,
      tags: extract("TAGS").split(",").map(t => t.trim()).filter(Boolean),
      summary: extract("RESUMO"),
      steamUrl: item.url,
      originalTitle: item.title,
      steamDate: formatDate(item.date),
      generatedAt: new Date().toLocaleString("pt-BR"),
      status: "pending",
    };
  }, []);

  // ── publish to site ────────────────────────────────────────────────────────
  const publishPost = useCallback(async (post) => {
    if (!apiEndpoint) {
      addLog("⚠ Endpoint do site não configurado.", "warn");
      return false;
    }
    const payload = {
      title: post.title,
      subtitle: post.subtitle,
      content: post.body,
      excerpt: post.summary,
      tags: post.tags,
      category: post.category,
      status: publishMode,
      meta: {
        steam_gid: post.steamGid,
        steam_url: post.steamUrl,
        original_title: post.originalTitle,
        read_time: post.readTime,
      },
    };
    const headers = { "Content-Type": "application/json" };
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;

    const res = await fetch(apiEndpoint, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return true;
  }, [apiEndpoint, apiToken, publishMode]);

  // ── main cycle ─────────────────────────────────────────────────────────────
  const runCycle = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchSteamNews();
      const newItems = items.filter(i => !seenGids.has(i.gid));

      if (newItems.length === 0) {
        addLog("✓ Nenhuma novidade nova encontrada.", "info");
        setLoading(false);
        return;
      }

      addLog(`🆕 ${newItems.length} post(s) novo(s) encontrado(s)!`, "success");

      for (const item of newItems.slice(0, 3)) {
        addLog(`✍ Gerando post: "${item.title}"`, "info");
        try {
          const post = await generatePost(item);
          setPosts(p => [post, ...p]);

          const newSeen = new Set(seenGids);
          newSeen.add(item.gid);
          setSeenGids(newSeen);
          saveSeen(newSeen);

          if (apiEndpoint) {
            setPosts(p => p.map(px => px.id === post.id ? { ...px, status: "publishing" } : px));
            try {
              await publishPost(post);
              setPosts(p => p.map(px => px.id === post.id ? { ...px, status: "published" } : px));
              addLog(`✅ Publicado: "${post.title}"`, "success");
            } catch (e) {
              setPosts(p => p.map(px => px.id === post.id ? { ...px, status: "error", errorMsg: e.message } : px));
              addLog(`❌ Erro ao publicar: ${e.message}`, "error");
            }
          } else {
            addLog(`📝 Post salvo localmente (configure o endpoint para publicar)`, "info");
          }
        } catch (e) {
          addLog(`❌ Erro ao gerar post para "${item.title}": ${e.message}`, "error");
        }
      }
    } catch (e) {
      addLog(`❌ Erro ao buscar Steam: ${e.message}`, "error");
    }
    setLoading(false);
  }, [fetchSteamNews, generatePost, publishPost, seenGids, saveSeen, addLog, apiEndpoint]);

  // ── timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) { clearInterval(timerRef.current); clearInterval(countdownRef.current); setCountdown(null); return; }
    timerRef.current = setInterval(runCycle, interval);
    let secs = interval / 1000;
    setCountdown(secs);
    countdownRef.current = setInterval(() => {
      secs -= 1;
      if (secs <= 0) secs = interval / 1000;
      setCountdown(secs);
    }, 1000);
    return () => { clearInterval(timerRef.current); clearInterval(countdownRef.current); };
  }, [running, interval, runCycle]);

  const toggleAgent = () => {
    if (!running) {
      setRunning(true);
      addLog("🟢 Agente iniciado. Executando ciclo inicial...", "success");
      runCycle();
    } else {
      setRunning(false);
      addLog("🔴 Agente pausado.", "info");
    }
  };

  const manualPublish = async (post) => {
    if (!apiEndpoint) { addLog("Configure o endpoint primeiro.", "error"); return; }
    setPosts(p => p.map(px => px.id === post.id ? { ...px, status: "publishing" } : px));
    try {
      await publishPost(post);
      setPosts(p => p.map(px => px.id === post.id ? { ...px, status: "published" } : px));
      addLog(`✅ Publicado manualmente: "${post.title}"`, "success");
    } catch (e) {
      setPosts(p => p.map(px => px.id === post.id ? { ...px, status: "error", errorMsg: e.message } : px));
      addLog(`❌ ${e.message}`, "error");
    }
  };

  const resetSeen = () => {
    setSeenGids(new Set());
    saveSeen(new Set());
    addLog("🔄 Histórico de posts lidos foi resetado.", "info");
  };

  const tabs = [
    { id: "posts", label: `Posts (${posts.length})` },
    { id: "config", label: "Configurar" },
    { id: "logs", label: `Logs (${logs.length})` },
  ];

  const fmtCountdown = (s) => {
    if (!s) return "";
    const m = Math.floor(s / 60), sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div style={s.root}>
      <style>{css}</style>

      {/* ── header ── */}
      <header style={s.header}>
        <div style={s.hLeft}>
          <div style={s.logo}>
            <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${APP_ID}/capsule_231x87.jpg`}
              alt="Drakantos" style={s.logoImg} onError={e => e.target.style.display = "none"} />
            <div>
              <div style={s.logoTitle}>Drakantos News Agent</div>
              <div style={s.logoSub}>Steam → Seu Site · AppID {APP_ID}</div>
            </div>
          </div>
        </div>
        <div style={s.hRight}>
          <div style={{ ...s.pill, background: running ? "#0a1f0f" : "#111", border: `1px solid ${running ? "#00ff9d33" : "#222"}` }}>
            <span style={{ ...s.dot, background: running ? "#00ff9d" : "#333", boxShadow: running ? "0 0 6px #00ff9d" : "none" }} className={running ? "pulse" : ""} />
            <span style={{ color: running ? "#00ff9d" : "#555", fontSize: 11 }}>
              {running ? (loading ? "processando..." : `próx. ${fmtCountdown(countdown)}`) : "inativo"}
            </span>
          </div>
        </div>
      </header>

      {/* ── tabs ── */}
      <nav style={s.nav}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ ...s.tab, ...(activeTab === t.id ? s.tabOn : {}) }}>
            {t.label}
          </button>
        ))}
        <div style={s.navRight}>
          <button onClick={toggleAgent} disabled={loading}
            style={{ ...s.btn, ...(running ? s.btnStop : s.btnStart) }}>
            {loading ? <span className="spinner" /> : running ? "⏹ Pausar" : "▶ Iniciar"}
          </button>
          <button onClick={runCycle} disabled={loading || running}
            style={{ ...s.btn, ...s.btnGhost }}>
            ↺ Agora
          </button>
        </div>
      </nav>

      <main style={s.main}>

        {/* ── POSTS TAB ── */}
        {activeTab === "posts" && (
          <div style={s.panel}>
            {posts.length === 0 ? (
              <div style={s.empty}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🐉</div>
                <p style={s.emptyT}>Nenhum post gerado ainda</p>
                <p style={s.emptyS}>Clique em ▶ Iniciar ou ↺ Agora para buscar as últimas novidades do Drakantos</p>
              </div>
            ) : posts.map(post => {
              const st = POST_STATUS[post.status];
              const open = expandedId === post.id;
              return (
                <article key={post.id} style={s.card} className="card-hover">
                  <div style={s.cardTop}>
                    <div style={s.cardMeta}>
                      <span style={{ ...s.badge, background: "#1a1020", color: "#c084fc", border: "1px solid #4a1a6a" }}>{post.category}</span>
                      <span style={{ ...s.badge, background: "#0a1015", color: "#60a5fa", border: "1px solid #1a3a5a" }}>⏱ {post.readTime}</span>
                      <span style={{ ...s.badge, background: "#0a120a", color: st.color, border: `1px solid ${st.color}33` }}>
                        {post.status === "publishing" && <span className="spinner-sm" />} {st.label}
                      </span>
                    </div>
                    <div style={s.cardActions}>
                      {post.status !== "published" && apiEndpoint && (
                        <button onClick={() => manualPublish(post)} style={s.publishBtn}>Publicar</button>
                      )}
                      <button onClick={() => setExpandedId(open ? null : post.id)} style={s.expandBtn}>
                        {open ? "Recolher ↑" : "Ver post ↓"}
                      </button>
                    </div>
                  </div>

                  <h2 style={s.cardTitle}>{post.title}</h2>
                  {post.subtitle && <p style={s.cardSub}>{post.subtitle}</p>}

                  <div style={s.cardFooter}>
                    <span style={s.cardDate}>Steam: {post.steamDate}</span>
                    <a href={post.steamUrl} target="_blank" rel="noreferrer" style={s.steamLink}>Ver na Steam ↗</a>
                  </div>

                  {open && (
                    <div style={s.expanded} className="fade-in">
                      {post.summary && (
                        <div style={s.summaryBox}>
                          <span style={s.summaryLabel}>RESUMO DO POST</span>
                          <p style={s.summaryText}>{post.summary}</p>
                        </div>
                      )}
                      <div style={s.divider} />
                      <p style={s.body}>{post.body}</p>
                      <div style={s.tagRow}>
                        {post.tags.map((t, i) => <span key={i} style={s.tag}>#{t}</span>)}
                      </div>
                      <div style={s.copyRow}>
                        <button onClick={() => navigator.clipboard.writeText(`${post.title}\n\n${post.subtitle}\n\n${post.body}`)} style={s.copyBtn}>
                          📋 Copiar texto
                        </button>
                        <button onClick={() => navigator.clipboard.writeText(JSON.stringify({ title: post.title, subtitle: post.subtitle, content: post.body, excerpt: post.summary, tags: post.tags, category: post.category }, null, 2))} style={s.copyBtn}>
                          { } Copiar JSON
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* ── CONFIG TAB ── */}
        {activeTab === "config" && (
          <div style={s.panel}>
            <Section title="INTEGRAÇÃO COM SEU SITE" accent="#4ae8c8">
              <Field label="Endpoint de publicação (URL da API do seu site)"
                placeholder="https://seusite.com/api/posts"
                value={apiEndpoint} onChange={setApiEndpoint}
                hint="O agente fará POST neste endpoint com o conteúdo gerado" />
              <Field label="Token de autenticação (Bearer)"
                placeholder="seu-token-secreto"
                value={apiToken} onChange={setApiToken}
                type="password"
                hint="Enviado no header Authorization: Bearer <token>" />
              <div style={{ marginTop: 12 }}>
                <label style={s.fieldLabel}>Status ao publicar</label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {["draft", "publish"].map(m => (
                    <button key={m} onClick={() => setPublishMode(m)}
                      style={{ ...s.modeBtn, ...(publishMode === m ? s.modeBtnOn : {}) }}>
                      {m === "draft" ? "📝 Rascunho" : "🌐 Publicar direto"}
                    </button>
                  ))}
                </div>
                <p style={s.fieldHint}>
                  {publishMode === "draft"
                    ? "Posts salvos como rascunho para revisão antes de publicar"
                    : "Posts publicados automaticamente sem revisão"}
                </p>
              </div>
            </Section>

            <Section title="PAYLOAD ENVIADO PARA O SITE" accent="#e8c84a">
              <pre style={s.codeBlock}>{`POST ${apiEndpoint || "https://seusite.com/api/posts"}
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Título em português",
  "subtitle": "Subtítulo do post",
  "content": "Corpo completo do post...",
  "excerpt": "Resumo curto para preview",
  "tags": ["Drakantos", "MMORPG", ...],
  "category": "Devlog",
  "status": "${publishMode}",
  "meta": {
    "steam_gid": "id_do_post_steam",
    "steam_url": "https://store.steampowered.com/...",
    "original_title": "Título original em inglês",
    "read_time": "3 min"
  }
}`}</pre>
            </Section>

            <Section title="FREQUÊNCIA DE VERIFICAÇÃO" accent="#c84ae8">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {INTERVALS.map(iv => (
                  <button key={iv.value} onClick={() => setIntervalVal(iv.value)}
                    style={{ ...s.intervalBtn, ...(interval === iv.value ? s.intervalBtnOn : {}) }}>
                    {iv.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="CONTROLES" accent="#ff7f50">
              <button onClick={resetSeen} style={{ ...s.btn, ...s.btnGhost, width: "100%" }}>
                🔄 Resetar histórico (re-processar todos os posts)
              </button>
              <p style={{ ...s.fieldHint, marginTop: 8 }}>
                Use para re-gerar posts que já foram vistos pelo agente ({seenGids.size} posts no histórico)
              </p>
            </Section>
          </div>
        )}

        {/* ── LOGS TAB ── */}
        {activeTab === "logs" && (
          <div style={s.panel}>
            {logs.length === 0 ? (
              <div style={s.empty}>
                <p style={s.emptyT}>Nenhum log ainda</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {logs.map((l, i) => (
                  <div key={l.id} style={{ ...s.logRow, animation: i === 0 ? "fadeIn .3s ease" : "none" }}>
                    <span style={s.logTime}>{l.time}</span>
                    <span style={{ ...s.logDot, background: l.type === "success" ? "#00ff9d" : l.type === "error" ? "#ff4d4d" : l.type === "warn" ? "#e8c84a" : "#555" }} />
                    <span style={{ ...s.logMsg, color: l.type === "error" ? "#ff4d4d" : l.type === "warn" ? "#e8c84a" : "#bbb" }}>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Section({ title, accent, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 3, height: 16, background: accent, borderRadius: 2, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 2, color: accent }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, placeholder, value, onChange, hint, type = "text" }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={s.fieldLabel}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={s.input} />
      {hint && <p style={s.fieldHint}>{hint}</p>}
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const s = {
  root: { minHeight: "100vh", background: "#070709", color: "#e0dff0", fontFamily: "'Source Serif 4', serif", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #161620", background: "#0c0c10" },
  hLeft: { display: "flex", alignItems: "center" },
  logo: { display: "flex", alignItems: "center", gap: 12 },
  logoImg: { height: 40, borderRadius: 6, objectFit: "cover" },
  logoTitle: { fontFamily: "'Cinzel', serif", fontWeight: 700, fontSize: 15, color: "#f0eeff", letterSpacing: 0.5 },
  logoSub: { fontSize: 10, color: "#444", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 },
  hRight: { display: "flex", alignItems: "center", gap: 10 },
  pill: { display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 20 },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, transition: "all .3s" },
  nav: { display: "flex", alignItems: "center", borderBottom: "1px solid #161620", background: "#0c0c10", padding: "0 20px" },
  tab: { background: "none", border: "none", color: "#444", padding: "11px 14px", cursor: "pointer", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", borderBottom: "2px solid transparent", transition: "all .2s" },
  tabOn: { color: "#e0dff0", borderBottomColor: "#c084fc" },
  navRight: { marginLeft: "auto", display: "flex", gap: 8 },
  btn: { padding: "7px 14px", border: "none", borderRadius: 6, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all .2s" },
  btnStart: { background: "linear-gradient(135deg,#16a34a,#15803d)", color: "#fff" },
  btnStop: { background: "linear-gradient(135deg,#b91c1c,#991b1b)", color: "#fff" },
  btnGhost: { background: "#111", border: "1px solid #222", color: "#888" },
  main: { flex: 1, overflowY: "auto", padding: "20px" },
  panel: { maxWidth: 780, margin: "0 auto" },
  empty: { textAlign: "center", padding: "60px 0" },
  emptyT: { fontFamily: "'Cinzel', serif", fontSize: 16, color: "#555", marginBottom: 8 },
  emptyS: { fontSize: 12, color: "#333", fontFamily: "'IBM Plex Mono', monospace", maxWidth: 360, margin: "0 auto", lineHeight: 1.6 },
  card: { background: "#0c0c10", border: "1px solid #1a1a28", borderRadius: 10, padding: "18px", marginBottom: 12, transition: "border .2s" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 },
  cardMeta: { display: "flex", gap: 6, flexWrap: "wrap" },
  cardActions: { display: "flex", gap: 6 },
  badge: { fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", padding: "3px 8px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4 },
  publishBtn: { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", background: "linear-gradient(135deg,#7c3aed,#6d28d9)", color: "#fff", border: "none", borderRadius: 5, padding: "5px 12px", cursor: "pointer" },
  expandBtn: { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", background: "#111", border: "1px solid #222", color: "#888", borderRadius: 5, padding: "5px 12px", cursor: "pointer" },
  cardTitle: { fontFamily: "'Cinzel', serif", fontSize: 17, fontWeight: 700, color: "#f0eeff", lineHeight: 1.3, marginBottom: 5 },
  cardSub: { fontSize: 13, color: "#888", fontStyle: "italic", lineHeight: 1.5, marginBottom: 10 },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardDate: { fontSize: 10, color: "#333", fontFamily: "'IBM Plex Mono', monospace" },
  steamLink: { fontSize: 10, color: "#60a5fa", fontFamily: "'IBM Plex Mono', monospace", textDecoration: "none" },
  expanded: { marginTop: 16 },
  summaryBox: { background: "#111", border: "1px solid #1e1e30", borderRadius: 6, padding: "10px 14px", marginBottom: 12 },
  summaryLabel: { display: "block", fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", color: "#c084fc", letterSpacing: 1, marginBottom: 5 },
  summaryText: { fontSize: 13, color: "#aaa", lineHeight: 1.6, margin: 0 },
  divider: { height: 1, background: "#1a1a28", margin: "12px 0" },
  body: { fontSize: 14, lineHeight: 1.85, color: "#ccc", whiteSpace: "pre-wrap" },
  tagRow: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 14 },
  tag: { fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: "#c084fc", background: "#150d1f", borderRadius: 4, padding: "3px 8px" },
  copyRow: { display: "flex", gap: 8, marginTop: 14 },
  copyBtn: { fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", background: "#111", border: "1px solid #222", color: "#888", borderRadius: 5, padding: "6px 12px", cursor: "pointer" },
  fieldLabel: { display: "block", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: "#666", marginBottom: 6, letterSpacing: 0.5 },
  input: { width: "100%", background: "#0e0e14", border: "1px solid #1e1e2e", borderRadius: 6, padding: "10px 14px", color: "#e0dff0", fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", outline: "none" },
  fieldHint: { fontSize: 11, color: "#383845", marginTop: 5, fontFamily: "'IBM Plex Mono', monospace" },
  codeBlock: { background: "#080810", border: "1px solid #1a1a28", borderRadius: 6, padding: "14px", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: "#6b7280", lineHeight: 1.7, overflowX: "auto", whiteSpace: "pre-wrap" },
  intervalBtn: { background: "#0e0e14", border: "1px solid #1e1e2e", borderRadius: 20, padding: "7px 16px", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: "#666", cursor: "pointer", transition: "all .2s" },
  intervalBtnOn: { background: "#1a0a2e", border: "1px solid #c084fc", color: "#c084fc" },
  modeBtn: { flex: 1, background: "#0e0e14", border: "1px solid #1e1e2e", borderRadius: 6, padding: "9px", fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#666", cursor: "pointer", transition: "all .2s" },
  modeBtnOn: { background: "#150d1f", border: "1px solid #7c3aed", color: "#c084fc" },
  logRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 5, background: "#0c0c10" },
  logTime: { fontSize: 10, color: "#2a2a35", fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 },
  logDot: { width: 6, height: 6, borderRadius: "50%", flexShrink: 0 },
  logMsg: { fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,wght@0,300;0,400;1,400&display=swap');
  @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }
  * { box-sizing:border-box; margin:0; padding:0; }
  ::-webkit-scrollbar { width:5px; }
  ::-webkit-scrollbar-track { background:#070709; }
  ::-webkit-scrollbar-thumb { background:#1a1a28; border-radius:3px; }
  .card-hover:hover { border-color:#2a2a40 !important; }
  .fade-in { animation:fadeIn .3s ease; }
  .pulse { animation:pulse 1.5s ease-in-out infinite; }
  .spinner { width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:inline-block; }
  .spinner-sm { width:8px;height:8px;border:1.5px solid rgba(255,255,255,.15);border-top-color:currentColor;border-radius:50%;animation:spin .7s linear infinite;display:inline-block; }
  input:focus { border-color:#7c3aed !important; }
  a:hover { opacity:.8; }
  button:disabled { opacity:.4; cursor:not-allowed; }
`;
