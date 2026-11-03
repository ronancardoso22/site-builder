-- =====================================================================
-- VÍDEOS NAS BUILDS E NOS GUIAS — 03/11/2026
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema.
--
-- O que faz:
--  1. Cria o balde "videos" (leitura pública), só MP4, WEBM e MOV,
--     no máximo 30 MB por arquivo.
--  2. Cada pessoa logada só envia/apaga dentro da própria pasta
--     (videos/<id-da-pessoa>/...). O admin pode apagar qualquer vídeo.
--  3. Limites: 3 vídeos por hora e 10 no total por pessoa, e o envio
--     para se o projeto inteiro passar de 850 MB (o plano grátis tem 1 GB).
--  4. O banco só aceita, dentro dos posts, vídeos deste balde.
-- =====================================================================

-- 1) Balde
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 31457280, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Limites de envio (função à parte para a regra não consultar a si mesma)
create or replace function public.pode_enviar_video()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from storage.objects o
      where o.bucket_id = 'videos'
        and (storage.foldername(o.name))[1] = (select auth.uid())::text
        and o.created_at > now() - interval '1 hour') < 3
    and
    (select count(*) from storage.objects o
      where o.bucket_id = 'videos'
        and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 10
    and
    (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o)
      < 850 * 1024 * 1024;
$$;
revoke all on function public.pode_enviar_video() from public, anon;
grant execute on function public.pode_enviar_video() to authenticated;

-- 3) Regras do balde
drop policy if exists "videos: enviar na minha pasta" on storage.objects;
create policy "videos: enviar na minha pasta" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('mp4', 'webm', 'mov')
    and (select public.pode_enviar_video())
  );

drop policy if exists "videos: listar a minha pasta" on storage.objects;
create policy "videos: listar a minha pasta" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "videos: apagar da minha pasta" on storage.objects;
create policy "videos: apagar da minha pasta" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'videos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

-- 4) Endereços de vídeo aceitos dentro dos posts: só este balde,
--    nome gerado pelo site (<uuid>/<uuid>.mp4|webm|mov).
create or replace function public.url_video_ok(u text)
returns boolean
language sql immutable set search_path = ''
as $$
  select u is not null
    and char_length(u) <= 300
    and u ~ '^https://tixxigsfgkcpnjccjbwd\.supabase\.co/storage/v1/object/public/videos/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm|mov)$';
$$;

-- Mesma checagem de antes + a lista "videos" de cada seção (no máximo 3)
create or replace function public.secoes_ok(s jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_path_query(s, 'lax $.**') as v
    where jsonb_typeof(v) = 'string'
      and (v #>> '{}') ~* '^(data:|javascript:|vbscript:|file:)'
  )
  and not exists (
    select 1
    from jsonb_path_query(s, 'lax $.**.images[*]') as v
    where not public.url_imagem_ok(v #>> '{}')
  )
  and not exists (
    select 1
    from jsonb_path_query(s, 'lax $.**.img') as v
    where jsonb_typeof(v) = 'string' and not public.url_imagem_ok(v #>> '{}')
  )
  and not exists (
    select 1
    from jsonb_path_query(s, 'lax $.**.videos[*]') as v
    where jsonb_typeof(v) <> 'string' or not public.url_video_ok(v #>> '{}')
  )
  and not exists (
    select 1
    from jsonb_path_query(s, 'lax $.**.videos') as v
    where jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 3
  );
$$;
