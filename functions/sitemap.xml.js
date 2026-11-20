// Mapa do site para o Google: as seções e todos os posts públicos (ver seo/seo.js)
import { URL_DO_SITE, esc, idValido, supabase } from '../seo/seo.js';

export async function onRequestGet() {
  let posts = [];
  try {
    // shortcut: no máximo 5000 posts (o limite do arquivo é 50 mil); se passar disso, dividir em vários sitemaps
    posts = await supabase('posts?select=id,updated_at&suspended=is.false&order=updated_at.desc&limit=5000');
  } catch (e) { console.error('[seo] sitemap sem posts', e); }
  const urls = ['/', '/builds', '/guias', '/novidades'].map(c => `<url><loc>${URL_DO_SITE}${c}</loc></url>`)
    .concat(posts.filter(p => idValido(p.id)).map(p =>
      `<url><loc>${URL_DO_SITE}/post/${p.id}</loc><lastmod>${esc(String(p.updated_at).slice(0, 10))}</lastmod></url>`));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
