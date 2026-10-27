/*
  CONFIGURAÇÃO DO BANCO (Supabase) — 25/10/2026

  Enquanto os dois campos abaixo estiverem vazios, o site continua no
  modo antigo (dados só neste navegador). Quando você preencher, o site
  passa a usar o banco de verdade.

  ONDE ACHAR: painel do Supabase > Project Settings > API Keys (ou "Data API")
    url     → "Project URL", algo como https://abcdefgh.supabase.co
    anonKey → a chave PUBLICÁVEL: começa com "sb_publishable_"
              (em projetos antigos aparece como "anon public", começa com "eyJ")

  PODE IR PARA O GITHUB? Sim. Essa chave foi feita para ficar no site,
  quem protege os dados são as regras do banco (RLS).

  NUNCA cole aqui a chave "secret" / "service_role". Ela ignora todas as
  regras de segurança. O site se recusa a funcionar se ela for colada.
*/
window.DRK_SUPABASE = {
  url:     'https://tixxigsfgkcpnjccjbwd.supabase.co',
  anonKey: 'sb_publishable_BSocTOgkQ5U7r35Q8PVEcw_0ywdOFmT',
  // CAPTCHA anti-robô (Cloudflare Turnstile). Cole aqui a "Site Key" (pública).
  // Deixe vazio para desligar. A "Secret Key" vai SÓ no painel do Supabase.
  turnstileSiteKey: '',
};
