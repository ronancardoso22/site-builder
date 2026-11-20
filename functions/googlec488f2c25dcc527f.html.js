// Verificação do Google Search Console (20/11/2026). NÃO APAGUE: o Google confere de vez em quando.
// É uma função, e não um arquivo .html, porque a Cloudflare redireciona "algo.html" para "algo"
// e o Google precisa achar o arquivo exatamente neste endereço.
export const onRequestGet = () => new Response('google-site-verification: googlec488f2c25dcc527f.html',
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
