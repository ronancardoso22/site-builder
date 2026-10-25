-- =====================================================================
-- NOTÍCIAS AUTOMÁTICAS DA STEAM — 25/10/2026
-- Depende de 01-banco.sql. Pode rodar de novo sem problema.
-- =====================================================================

-- 1) Lista das notícias da Steam já importadas (para não repetir).
--    RLS ligado e sem regras = ninguém do site lê nem grava; só a função do servidor.
create table if not exists public.steam_importadas (
  gid text primary key check (gid ~ '^[0-9]{1,30}$'),
  importada_em timestamptz not null default now()
);
alter table public.steam_importadas enable row level security;
revoke all on public.steam_importadas from anon, authenticated;

-- 2) Conferência do segredo do agendador (segredo guardado no Vault).
create or replace function public.noticias_segredo_ok(s text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'noticias_secret' and decrypted_secret = s
  );
$$;
revoke all on function public.noticias_segredo_ok(text) from public, anon, authenticated;
grant execute on function public.noticias_segredo_ok(text) to service_role;

-- 3) Regra de posts: o servidor (service_role) conta como administrador
--    e pode escolher o autor (o administrador). Pessoas continuam iguais.
create or replace function public.proteger_post()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  servidor boolean := current_user = 'service_role';
  admin boolean := servidor or public.is_admin();
  tags_ok text[];
begin
  if tg_op = 'INSERT' then
    if not servidor then
      new.author_id := (select auth.uid());
    end if;
    new.created_at := now();
    if new.author_id is null then
      raise exception 'É preciso estar logado.';
    end if;
    if not admin then
      new.suspended := false;
      if new.type = 'novidades' then
        raise exception 'Só o administrador publica novidades.';
      end if;
      if (select count(*) from public.posts
          where author_id = new.author_id and created_at > now() - interval '1 hour') >= 20 then
        raise exception 'Muitos posts em pouco tempo. Tente mais tarde.';
      end if;
    end if;
  else
    new.id         := old.id;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
    if not admin then
      new.type      := old.type;
      new.suspended := old.suspended;
    end if;
  end if;

  tags_ok := case new.type
    when 'novidades' then array['ATUALIZAÇÃO','EVENTO','NOTÍCIAS']
    when 'builds'    then array['PVE','PVP','FARM','ENDGAME']
    else                  array['INICIANTE','AVANÇADO','ECONOMIA','DUNGEON']
  end;
  if not (new.tags <@ tags_ok) then
    raise exception 'Tag inválida para este tipo de post.';
  end if;
  if not public.url_imagem_ok(new.card_image) or not public.secoes_ok(new.sections) then
    raise exception 'Imagem com endereço não permitido.';
  end if;

  new.title      := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;

-- 4) Agendamento diário (12:00 UTC = 9h em Brasília).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'noticias_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'noticias_secret',
      'Segredo do agendador de notícias da Steam');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'noticias-steam';
select cron.schedule('noticias-steam', '0 12 * * *', $$
  select net.http_post(
    url := 'https://tixxigsfgkcpnjccjbwd.supabase.co/functions/v1/noticias-steam',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'noticias_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
