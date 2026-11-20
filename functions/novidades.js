// Seção /novidades com título e descrição próprios (ver seo/seo.js)
import { PAGINAS, entregarPagina } from '../seo/seo.js';
export const onRequestGet = ctx => entregarPagina(ctx, { ...PAGINAS['/novidades'], caminho: '/novidades' });
