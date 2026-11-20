// robots.txt: todo o site pode ser lido; o mapa dos posts fica no sitemap.xml
import { URL_DO_SITE } from '../seo/seo.js';
export const onRequestGet = () => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${URL_DO_SITE}/sitemap.xml\n`,
  { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
