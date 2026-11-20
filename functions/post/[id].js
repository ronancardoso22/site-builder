// Página de um post (/post/ID): título, descrição, prévia e o texto do post já no HTML (ver seo/seo.js)
import { buscarPost, entregarPagina, htmlDoPost, imagemDaPrevia, resumo } from '../../seo/seo.js';

export async function onRequestGet(ctx) {
  const id = String(ctx.params.id || '');
  let post = null, falhou = false;
  try { post = await buscarPost(id); }
  catch (e) { falhou = true; console.error('[seo] erro ao buscar post', e); }
  const caminho = '/post/' + encodeURIComponent(id);
  if (!post) {
    // Post apagado, suspenso ou ainda oculto: o JavaScript decide (o autor/admin logado ainda consegue ver).
    // Banco fora do ar: 503 avisa o Google para tentar de novo depois, em vez de esquecer o post.
    return entregarPagina(ctx, { titulo: 'Post · Drakbuilder', descricao: 'Post do Drakbuilder.', caminho, semIndice: true, status: falhou ? 503 : 404 });
  }
  return entregarPagina(ctx, {
    titulo: `${post.title} · Drakbuilder`,
    descricao: resumo(post.descr || post.sections?.[0]?.content || post.title),
    caminho,
    imagem: imagemDaPrevia(post.card_image),
    tipo: 'article',
    tela: 'page-detail',
    conteudo: htmlDoPost(post),
  });
}
