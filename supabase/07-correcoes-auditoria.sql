-- =====================================================================
-- CORREÇÕES DA AUDITORIA — 20/11/2026
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
-- (É o SQL EDITOR, não o editor de Edge Functions.)
-- Pode rodar de novo sem problema. Não apaga nada.
--
-- O que faz:
--  1. Limite de imagens: 300 no total por pessoa (antes 1000) e o envio
--     para se o projeto inteiro passar de 850 MB (o plano grátis tem 1 GB).
--     Antes, uma conta sozinha conseguia lotar o armazenamento.
--  2. Filtro de palavrões: um texto que começa com um link não escapa
--     mais do filtro. Só endereços puros (sem espaços) ficam de fora.
-- =====================================================================

-- 1) Limite de imagens
create or replace function public.pode_enviar_imagem()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from storage.objects o
      where o.bucket_id = 'imagens'
        and (storage.foldername(o.name))[1] = (select auth.uid())::text
        and o.created_at > now() - interval '1 hour') < 60
    and
    (select count(*) from storage.objects o
      where o.bucket_id = 'imagens'
        and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 300
    and
    (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o)
      < 850 * 1024 * 1024;
$$;
revoke all on function public.pode_enviar_imagem() from public, anon;
grant execute on function public.pode_enviar_imagem() to authenticated;

-- 2) Filtro de palavrões nas seções dos posts
create or replace function public.filtrar_palavroes_jsonb(j jsonb, padrao text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
begin
  if j is null or padrao is null then
    return j;
  end if;
  case jsonb_typeof(j)
    when 'string' then
      -- só pula se o texto for APENAS um endereço (sem espaços); antes,
      -- começar o texto com um link fazia o resto escapar do filtro
      if (j #>> '{}') ~* '^(https?://|imagens/)\S*$' then
        return j;
      end if;
      return to_jsonb(public.filtrar_palavroes(j #>> '{}', padrao));
    when 'array' then
      return coalesce((
        select jsonb_agg(public.filtrar_palavroes_jsonb(e, padrao) order by i)
        from jsonb_array_elements(j) with ordinality as a(e, i)), '[]'::jsonb);
    when 'object' then
      return coalesce((
        select jsonb_object_agg(k,
                 case when k in ('id', 'img', 'images', 'videos') then v
                      else public.filtrar_palavroes_jsonb(v, padrao) end)
        from jsonb_each(j) as e(k, v)), '{}'::jsonb);
    else
      return j;
  end case;
end;
$$;
revoke all on function public.filtrar_palavroes_jsonb(jsonb, text) from public, anon, authenticated;

select 'Correções da auditoria instaladas.' as resultado;
