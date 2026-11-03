// =====================================================================
// NOTÍCIAS DA STEAM -> BANCO (Supabase Edge Function) — 25/10/2026
// 03/11/2026: correções de tradução, links protegidos, fonte = página da Steam.
//
// Roda sozinha 1x por dia (agendada no banco com pg_cron). Busca as
// notícias do Drakantos na Steam, traduz para português só os parágrafos
// que estão em inglês (DeepL se houver chave, senão MyMemory, ambos
// grátis) e grava como post do tipo "novidades".
//
// SEGURANÇA
// - Só aceita chamadas com o segredo certo no cabeçalho x-cron-secret.
//   O segredo fica no cofre (Vault) do banco e é conferido pela função
//   noticias_segredo_ok, que só a chave de serviço pode chamar.
// - A chave de serviço só existe aqui dentro, no servidor. Nunca no site.
// - Imagens: as do servidor do estúdio são copiadas para o nosso Storage;
//   as da CDN da Steam ficam como estão. Texto sem < > (o banco também confere).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const APP_ID = "2454980";               // Drakantos na Steam
const MAX_NEWS = 5;
const REVISAR = (Deno.env.get("NOTICIAS_REVISAR") ?? "sim") === "sim"; // sim = chega oculta para o admin revisar
const DEEPL_KEY = Deno.env.get("DEEPL_API_KEY") ?? "";
const MYMEMORY_EMAIL = Deno.env.get("MYMEMORY_EMAIL") ?? "";

// Termos que NÃO devem ser traduzidos (ficam como estão). Os mais longos primeiro.
const GLOSSARIO = ["Steam Deck", "Patch Notes", "Drakantos", "Discord", "Steam", "PvP", "PvE", "XP", "DPS", "MMO", "Builds", "Build", "builds", "build"];

// Correções depois da tradução automática (03/11/2026): erros vistos no devlog
// e palavras em português que vieram sem acento.
const CORRECOES: [RegExp, string][] = [
  [/\b(Baralho|Deck) (de|do) Vapor\b/gi, "Steam Deck"],
  [/\bcompilaç(ão|ao)\b/gi, "build"],
  [/\bcompilaç(ões|oes)\b/gi, "builds"],
  [/\bbrincar com (um|o) controle\b/gi, "jogar com $1 controle"],
  [/\balavanca direita\b/gi, "analógico direito"],
  [/\balavanca esquerda\b/gi, "analógico esquerdo"],
  [/\bcobranças\b/g, "cargas"],
  [/\bsistema de e-?mail\b/gi, "sistema de correio"],
  [/\bvoce\b/g, "você"], [/\bVoce\b/g, "Você"], [/\bvoces\b/g, "vocês"],
  [/\bpagina\b/g, "página"], [/\bnao\b/g, "não"], [/\bNao\b/g, "Não"],
  [/\btambem\b/g, "também"], [/\bentao\b/g, "então"], [/\bsao\b/g, "são"],
  [/\batualizacao\b/g, "atualização"], [/\binformacoes\b/g, "informações"],
];
const corrigir = (t: string) => CORRECOES.reduce((acc, [re, novo]) => acc.replace(re, novo), t);
const PALAVRAS_EN = new Set("hey hi hello everyone welcome thank thanks you we've we're it's officially reached here of to in on by at an be if or not but out up get got our us my the and with will you your new update fixed added removed now from this that have has for are is was were which when where our we it its been can more players player some all into than these those there their they them should would could also only just about after before during while".split(" "));
const PALAVRAS_PT = new Set("o a os as um uma de do da dos das em no na nos nas para por com que não é são foi foram mais seu sua seus suas também agora novo nova novos novas jogadores jogador corrigido adicionado removido".split(" "));

const palavras = (t: string) => t.toLowerCase().replace(/[’‘]/g, "'").match(/[a-zà-ú']+/g) ?? [];
function proporcaoIngles(t: string) {
  const p = palavras(t); if (!p.length) return 0;
  return p.filter((w) => PALAVRAS_EN.has(w)).length / p.length;
}
function pareceIngles(t: string) {
  const p = palavras(t); if (!p.length) return false;
  const en = p.filter((w) => PALAVRAS_EN.has(w)).length;
  const pt = p.filter((w) => PALAVRAS_PT.has(w)).length;
  if (en === 0 && pt === 0) return /^[\x00-\x7F’]*$/.test(t) && p.length >= 2;
  return en > pt;
}

const IMG_OK = /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|steamusercontent\.com|akamaihd\.net)\/[^\s<>"'`\\]+$/i;
// Imagens das notícias que o próprio estúdio hospeda: são COPIADAS para o
// nosso Storage (o site não carrega nada direto desse servidor).
const IMG_ESTUDIO = /^https:\/\/static\.drakantos\.com\/[A-Za-z0-9\/_.%-]+\.(png|jpe?g|gif|webp)$/i;
const MAX_IMG = 2 * 1024 * 1024; // mesmo limite do bucket
const TIPOS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

function limparTexto(raw: string) {
  // Cada imagem vira uma marca §IMGk§ numa linha própria, no lugar onde
  // estava no texto. Depois a marca vira "[imagem N]" (o site mostra ali).
  const imagens: string[] = [];
  const marca = (src: string) => {
    const u = String(src).trim();
    if (u.length > 500 || u.includes("..") || !(IMG_OK.test(u) || IMG_ESTUDIO.test(u))) return "";
    let k = imagens.indexOf(u);
    if (k < 0) { k = imagens.length; imagens.push(u); }
    return `\n§IMG${k}§\n`;
  };
  let t = raw.replace(/\{STEAM_CLAN_IMAGE\}/g, "https://clan.akamai.steamstatic.com/images");
  t = t.replace(/\[img[^\]]*\](.*?)\[\/img\]/gis, (_, src) => marca(src));
  t = t.replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (_, src) => marca(src));
  t = t.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gis, "$2 ($1)");
  t = t.replace(/\[\*\]/g, "\n- ");
  t = t.replace(/\[h[1-6]\](.*?)\[\/h[1-6]\]/gis, "\n\n## $1\n\n");
  t = t.replace(/\[\/?[a-z0-9]+[^\]]*\]/gi, "");
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/[<>`]/g, "");                 // nada que pareça código
  t = t.split("\n").map((l) => l.trim().match(/^§IMG\d+§$/) ? l.trim() : l).join("\n");
  t = t.replace(/^\s*(§IMG\d+§)\s*(\S.*)$/gm, "$1\n$2"); // marca sempre sozinha na linha
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texto: t, imagens };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const regexGlossario = new RegExp(`\\b(${GLOSSARIO.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");

async function traduzirDeepL(textos: string[]) {
  const protegidos = textos.map((t) => escapeXml(t).replace(regexGlossario, "<x>$1</x>"));
  const base = DEEPL_KEY.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const res = await fetch(`${base}/v2/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: protegidos, source_lang: "EN", target_lang: "PT-BR", tag_handling: "xml", ignore_tags: ["x"], preserve_formatting: true }),
  });
  if (!res.ok) throw new Error(`DeepL respondeu ${res.status}`);
  const data = await res.json();
  return data.translations.map((t: { text: string }) => unescapeXml(t.text.replace(/<\/?x>/g, "")));
}

// Troca links e termos do glossário por marcas (ZQ0QZ...) que o tradutor não
// mexe, e depois devolve. Assim os links do Discord etc. continuam inteiros.
function proteger(texto: string) {
  const guardados: string[] = [];
  const marca = (m: string) => { guardados.push(m); return `ZQ${guardados.length - 1}QZ`; };
  const t = texto
    .replace(/https?:\/\/[^\s()<>"'`]+/g, (u) => { const fim = u.match(/[.,!?;:]+$/)?.[0] ?? ""; return marca(u.slice(0, u.length - fim.length)) + fim; })
    .replace(regexGlossario, marca);
  return { t, guardados };
}
function devolver(texto: string, guardados: string[]) {
  let t = texto.replace(/ZQ\s?(\d+)\s?QZ/gi, (_, n) => guardados[Number(n)] ?? "");
  // Se o tradutor engoliu algum link, ele volta no fim do parágrafo
  for (const g of guardados) if (/^https?:/.test(g) && !t.includes(g)) t += ` ${g}`;
  return t;
}

async function traduzirMyMemory(textosOriginais: string[]) {
  const saida: string[] = [];
  const enc = new TextEncoder();
  const protegidos = textosOriginais.map(proteger);
  for (const { t: texto, guardados } of protegidos) {
    const partes = texto.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [texto];
    let resultado = "", bloco = "";
    const enviar = async () => {
      if (!bloco.trim()) { resultado += bloco; bloco = ""; return; }
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(bloco)}&langpair=en|pt-BR${MYMEMORY_EMAIL ? `&de=${encodeURIComponent(MYMEMORY_EMAIL)}` : ""}`;
      const data = await (await fetch(url)).json();
      if (data.responseStatus !== 200) throw new Error(`MyMemory: ${data.responseDetails || data.responseStatus}`);
      resultado += String(data.responseData.translatedText).trim() + (bloco.match(/\s*$/)?.[0] ?? "");
      bloco = "";
    };
    for (const parte of partes) {
      if (enc.encode(bloco + parte).length > 450) await enviar();
      bloco += parte;
    }
    await enviar();
    saida.push(devolver(resultado.trim(), guardados));
  }
  return saida;
}

const traduzirLista = (t: string[]) => (DEEPL_KEY ? traduzirDeepL(t) : traduzirMyMemory(t));

async function traduzirTexto(texto: string) {
  const par = texto.split("\n");
  const idx = par.map((p, i) => [p, i] as const).filter(([p]) => p.trim() && pareceIngles(p.replace(/^(##\s*|-\s*)/, ""))).map(([, i]) => i);
  if (!idx.length) return corrigir(texto);
  const pref = idx.map((i) => par[i].match(/^(##\s*|-\s*)?/)![0]);
  const trad = await traduzirLista(idx.map((i, k) => par[i].slice(pref[k].length)));
  idx.forEach((i, k) => { par[i] = pref[k] + String(trad[k]).replace(/[<>`]/g, ""); });
  return corrigir(par.join("\n"));
}

function classificar(t: string) {
  t = t.toLowerCase();
  if (/patch|atualiza|update|hotfix|corre[çc]|balance/.test(t)) return { tag: "ATUALIZAÇÃO", emoji: "🛠️" };
  if (/evento|event|torneio|tournament|temporada|season/.test(t)) return { tag: "EVENTO", emoji: "🔥" };
  return { tag: "NOTÍCIAS", emoji: "📰" };
}

// Divide pelos títulos "##". Cada marca §IMGk§ vira "[imagem N]" da seção
// (N = posição na lista de imagens dela). Imagem que falhou ou é a capa: some.
function dividirSecoes(texto: string, id: string, urls: (string | null)[], capa: number) {
  const secoes: { name: string; linhas: string[] }[] = [];
  let atual = { name: "Visão Geral", linhas: [] as string[] };
  for (const linha of texto.split("\n")) {
    const h = linha.match(/^##\s*(.+)/);
    if (h) { if (atual.linhas.join("").trim()) secoes.push(atual); atual = { name: h[1].replace(/§IMG\d+§/g, "").trim().slice(0, 120) || "Seção", linhas: [] }; }
    else atual.linhas.push(linha);
  }
  if (atual.linhas.join("").trim()) secoes.push(atual);
  return secoes.map((s, i) => {
    const images: string[] = [];
    const content = s.linhas.map((l) => {
      const m = l.trim().match(/^§IMG(\d+)§$/);
      if (!m) return l.replace(/§IMG\d+§/g, "");
      const k = Number(m[1]);
      const u = urls[k];
      if (!u || k === capa) return null;
      images.push(u);
      return `[imagem ${images.length}]`;
    }).filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
    return { id: `${id}-s${i}`, name: s.name, content, images };
  }).filter((s) => s.content || s.images.length);
}

// Baixa cada imagem do estúdio (sem seguir redirecionamentos, só imagem,
// até 2 MB) e guarda em imagens/steam/<gid>/. Imagens da CDN da Steam ficam como estão.
// Devolve uma lista na mesma ordem (null = imagem que não deu certo).
async function copiarImagens(db: ReturnType<typeof createClient>, gid: string, urls: string[]) {
  const saida: (string | null)[] = urls.map(() => null);
  let salvas = 0;
  for (const [n, u] of urls.slice(0, 30).entries()) {
    if (salvas >= 20) break;
    if (IMG_OK.test(u)) { saida[n] = u; salvas++; continue; }
    try {
      const r = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(15000) });
      const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!r.ok || !TIPOS[tipo] || Number(r.headers.get("content-length") ?? 0) > MAX_IMG) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > MAX_IMG || bytes.length < 200) continue; // grande demais ou só espaçador
      const caminho = `steam/${gid}/${n}.${TIPOS[tipo]}`;
      const { error } = await db.storage.from("imagens").upload(caminho, bytes, { contentType: tipo, upsert: true });
      if (!error) { saida[n] = db.storage.from("imagens").getPublicUrl(caminho).data.publicUrl; salvas++; }
    } catch { /* imagem pulada */ }
  }
  return saida;
}

function resumoDe(texto: string) {
  const linhas = texto.split("\n").filter((l) => l.trim() && !l.startsWith("##") && !l.startsWith("-") && !l.startsWith("§IMG"));
  const p = linhas.find((l) => palavras(l).length >= 6) || linhas[0] || ""; // pula saudações curtas
  return p.length > 200 ? p.slice(0, 197).replace(/\s+\S*$/, "") + "..." : p;
}

Deno.serve(async (req) => {
  const segredo = req.headers.get("x-cron-secret") ?? "";
  if (segredo.length < 32 || segredo.length > 200) return new Response("proibido", { status: 403 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: liberado, error: erroSegredo } = await db.rpc("noticias_segredo_ok", { s: segredo });
  if (erroSegredo || liberado !== true) return new Response("proibido", { status: 403 });

  const { data: admin } = await db.from("profiles").select("id").eq("role", "admin").order("created_at").limit(1).maybeSingle();
  if (!admin) return Response.json({ erro: "nenhum administrador cadastrado" }, { status: 500 });

  const r = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP_ID}&count=${MAX_NEWS}&maxlength=0&feeds=steam_community_announcements&format=json`);
  if (!r.ok) return Response.json({ erro: `Steam respondeu ${r.status}` }, { status: 502 });
  const itens = (await r.json())?.appnews?.newsitems ?? [];

  const { data: vistas } = await db.from("steam_importadas").select("gid").in("gid", itens.map((i: { gid: string }) => String(i.gid)));
  const jaVistas = new Set((vistas ?? []).map((v: { gid: string }) => v.gid));

  const log: string[] = [];
  for (const item of itens) {
    const gid = String(item.gid);
    if (!/^[0-9]{1,30}$/.test(gid) || jaVistas.has(gid)) continue;
    const id = `steam-${gid}`;
    try {
      const limpo = limparTexto(String(item.contents || ""));
      const texto = limpo.texto;
      const titulo = (await traduzirTexto(String(item.title || "").replace(/[<>`]/g, ""))).slice(0, 200);
      const corpo = await traduzirTexto(texto);
      const ratio = proporcaoIngles(`${titulo}\n${corpo}`);
      if (ratio > 0.04) throw new Error(`ainda com ${(ratio * 100).toFixed(1)}% de inglês`);
      if (titulo.trim().length < 5) throw new Error("título curto demais");

      const imagens = await copiarImagens(db, gid, limpo.imagens);
      const capa = imagens.findIndex((u) => !!u);
      const { tag, emoji } = classificar(`${item.title} ${titulo}`);
      // Fonte: sempre a página da notícia na loja da Steam (o item.url às vezes
      // aponta para um servidor da Akamai, que confunde o leitor).
      const fonte = `https://store.steampowered.com/news/app/${APP_ID}/view/${gid}`;
      const { error } = await db.from("posts").insert({
        id, type: "novidades", author_id: admin.id,
        title: titulo, descr: resumoDe(corpo).slice(0, 1000), emoji, tags: [tag],
        card_image: capa >= 0 ? imagens[capa] : null,
        sections: [...dividirSecoes(corpo, id, imagens, capa), { id: `${id}-fonte`, name: "Fonte", content: `Publicado originalmente na Steam: ${fonte}`, images: [] }],
        suspended: REVISAR,
      });
      if (error && error.code !== "23505") throw new Error(error.message);
      await db.from("steam_importadas").insert({ gid });
      log.push(`ok: ${titulo}`);
    } catch (e) {
      log.push(`pulada ${gid}: ${(e as Error).message}`); // tenta de novo amanhã
    }
  }
  return Response.json({ revisar: REVISAR, resultado: log });
});
