// Teste rápido das partes de segurança do seo.js. Rodar: node seo/seo.test.mjs
import assert from 'node:assert/strict';
import { URL_DO_SITE, esc, idValido, imagemDaPrevia, resumo, htmlDoPost } from './seo.js';

const PADRAO = URL_DO_SITE + '/imagens/steam/ss01.jpg';
assert.equal(esc(`<a "x">&'`), '&lt;a &quot;x&quot;&gt;&amp;&#39;');
assert.equal(idValido('abc_123-X'), true);
assert.equal(idValido('a&id=eq.b'), false);
assert.equal(imagemDaPrevia('imagens/steam/ss02.jpg'), URL_DO_SITE + '/imagens/steam/ss02.jpg');
assert.equal(imagemDaPrevia('imagens/../x.png'), PADRAO);
assert.equal(imagemDaPrevia('data:image/png;base64,AA'), PADRAO);
assert.equal(imagemDaPrevia('javascript:alert(1)'), PADRAO);
assert.equal(resumo('a\n[imagem 1]\nb'), 'a b');
const html = htmlDoPost({ type: 'builds', title: '<script>x</script>', descr: '', created_at: '2026-11-10T12:00:00Z',
  sections: [{ name: '<b>', content: 'oi\n[youtube]\n<img onerror=x>' }], autor: { name: '</title>' } });
assert.ok(!/<script|<img|<b>|<\/title>/.test(html), 'texto do usuário tem que sair escapado');
console.log('seo.js ok');
