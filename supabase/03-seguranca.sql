-- =====================================================================
-- REVISÃO DE SEGURANÇA — 25/10/2026
-- Limites de uso (rate limit) direto no banco. Pode rodar de novo.
-- =====================================================================

-- 1) Envio de imagens: no máximo 60 por hora e 1000 no total por pessoa.
--    A contagem fica numa função à parte (uma regra que consulta a própria
--    tabela entraria em laço infinito).
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
        and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 1000;
$$;
revoke all on function public.pode_enviar_imagem() from public, anon;
grant execute on function public.pode_enviar_imagem() to authenticated;

drop policy if exists "imagens: enviar na minha pasta" on storage.objects;
create policy "imagens: enviar na minha pasta" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imagens'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.pode_enviar_imagem())
  );

-- 2) Seguir pessoas: no máximo 100 por hora. A data é sempre a do servidor.
revoke insert on public.follows from authenticated;
grant insert (follower_id, followed_id) on public.follows to authenticated;

create or replace function public.limitar_follows()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.created_at := now();
  if (select count(*) from public.follows
      where follower_id = new.follower_id and created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Muitas ações em pouco tempo. Tente mais tarde.';
  end if;
  return new;
end;
$$;
drop trigger if exists antes_de_seguir on public.follows;
create trigger antes_de_seguir
  before insert on public.follows
  for each row execute function public.limitar_follows();

-- 3) Editar post: quem não é admin espera 3 segundos entre uma edição e outra
--    do mesmo post (impede "metralhar" o banco com edições).
create or replace function public.limitar_edicao_post()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user <> 'service_role' and not public.is_admin()
     and old.updated_at > now() - interval '3 seconds' then
    raise exception 'Muitas ações em pouco tempo. Tente mais tarde.';
  end if;
  return new;
end;
$$;
drop trigger if exists antes_de_editar_post_limite on public.posts;
create trigger antes_de_editar_post_limite
  before update on public.posts
  for each row execute function public.limitar_edicao_post();

-- 4) As funções acima são só de gatilho: ninguém de fora chama.
revoke all on function public.limitar_follows() from public, anon, authenticated;
revoke all on function public.limitar_edicao_post() from public, anon, authenticated;

-- 5) Aviso do Supabase: extensão pg_net estava no esquema public.
--    Reinstala no esquema "extensions" (o agendamento continua igual).
drop extension if exists pg_net;
create extension pg_net with schema extensions;
