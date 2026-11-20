// Página inicial com título, descrição e prévia para Google/Discord/WhatsApp (ver seo/seo.js)
import { PAGINAS, entregarPagina } from '../seo/seo.js';
export const onRequestGet = ctx => entregarPagina(ctx, { ...PAGINAS['/'], caminho: '/' });
