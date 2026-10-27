-- =====================================================================
--  DRAKBUILDER — BANCO DE DADOS (Supabase / PostgreSQL)
--  Criado em 25/10/2026
--
--  COMO USAR: no painel do Supabase, abra "SQL Editor" > "New query",
--  cole ESTE ARQUIVO INTEIRO e clique em "Run". Pode rodar de novo
--  sem medo: ele recria funções e regras sem apagar dados.
--
--  SEGURANÇA, EM RESUMO
--  - Toda tabela tem RLS (Row Level Security) LIGADO. Sem uma regra
--    que permita, ninguém lê nem escreve nada.
--  - O site só usa a chave pública ("anon"). Ela NÃO dá poder nenhum
--    além do que estas regras permitem.
--  - Senhas ficam no Supabase Auth (bcrypt). Este banco nunca vê senha.
--  - O e-mail fica só no Auth (privado). A tabela de perfis é pública
--    e por isso NÃO guarda e-mail.
--  - Ninguém consegue se promover a admin pelo site: a coluna "role"
--    não pode ser alterada pela chave pública.
--
--  LGPD, EM RESUMO
--  - Coleta mínima: nome de exibição, e-mail e senha. Bio e foto são
--    opcionais.
--  - Guardamos QUANDO a pessoa aceitou a política de privacidade e
--    qual versão (prova de consentimento, art. 8º §2º).
--  - Idade mínima de 13 anos (decisão do ronan, 25/10/2026).
--  - exportar_meus_dados(): a pessoa baixa tudo o que temos dela
--    (art. 18, II e V).
--  - excluir_minha_conta(): apaga a conta e TUDO ligado a ela
--    (art. 18, VI).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PERFIS (dados públicos de cada conta)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null
                  check (char_length(name) between 3 and 40 and name !~ '[<>"''`\\]'),
  bio             text check (bio is null or char_length(bio) <= 260),
  avatar_url      text check (avatar_url is null or char_length(avatar_url) <= 500),
  role            text not null default 'user' check (role in ('user', 'admin')),
  notif_muted     boolean not null default false,
  consent_version text not null,
  consent_at      timestamptz not null default now(),
  age_13_plus     boolean not null check (age_13_plus),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;


-- ---------------------------------------------------------------------
-- 2. POSTS (builds, guias e novidades)
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id                 text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  type               text not null check (type in ('builds', 'guias', 'novidades')),
  author_id          uuid not null references public.profiles(id) on delete cascade,
  title              text not null check (char_length(title) between 5 and 200),
  descr              text not null default '' check (char_length(descr) <= 1000),
  emoji              text check (emoji is null or char_length(emoji) <= 16),
  tags               text[] not null default '{}' check (cardinality(tags) <= 10),
  card_image         text check (card_image is null or char_length(card_image) <= 500),
  sections           jsonb not null default '[]'::jsonb
                     check (jsonb_typeof(sections) = 'array' and octet_length(sections::text) <= 300000),
  youtube_url        text check (youtube_url is null or (
                       char_length(youtube_url) <= 300
                       and youtube_url ~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/'
                       and youtube_url !~ '[\s<>"''`\\]')),
  youtube_embeddable boolean,
  suspended          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists posts_type_created_idx on public.posts (type, created_at desc);
create index if not exists posts_author_idx       on public.posts (author_id);

alter table public.posts enable row level security;


-- ---------------------------------------------------------------------
-- 3. SEGUIDORES
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index if not exists follows_followed_idx on public.follows (followed_id);

alter table public.follows enable row level security;


-- ---------------------------------------------------------------------
-- 4. NOTIFICAÇÕES (criadas só pelo próprio banco, nunca pelo site)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         text not null default 'new_post' check (type in ('new_post')),
  from_user_id uuid references public.profiles(id) on delete cascade,
  post_id      text references public.posts(id) on delete cascade,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;


-- =====================================================================
-- FUNÇÕES AUXILIARES
-- "security definer" = roda com poder do dono do banco, por isso cada
-- uma usa search_path vazio e nomes completos (evita sequestro de nomes).
-- =====================================================================

-- É administrador? (lê o papel do usuário logado)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Endereços de imagem aceitos: Storage deste Supabase, pasta imagens/
-- do próprio site, ou CDN oficial da Steam. Nada de "javascript:" etc.
create or replace function public.url_imagem_ok(u text)
returns boolean
language sql immutable set search_path = ''
as $$
  select u is null or (
    char_length(u) <= 500
    and u !~ '[\s<>"''`\\]'
    and u !~ '\.\.'
    and (
      u ~ '^https://tixxigsfgkcpnjccjbwd\.supabase\.co/storage/v1/object/public/imagens/'
      or u ~* '^imagens/[^?#]+\.(png|jpe?g|webp|gif)$'
      or u ~* '^https://([a-z0-9-]+\.)*(steamstatic\.com|steamusercontent\.com|akamaihd\.net)/'
    )
  );
$$;

-- Percorre as seções e confere TODO texto que pareça imagem (campo "img"
-- ou lista "images"). Imagens em base64 não são aceitas no banco: o site
-- envia para o Storage antes.
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
  );
$$;


-- =====================================================================
-- GATILHOS (regras que o banco aplica sozinho, impossíveis de pular)
-- =====================================================================

-- 4.1 Ao criar uma conta no Auth, cria o perfil.
--     Recusa o cadastro se faltar o aceite da política ou da idade.
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nome text  := btrim(coalesce(meta->>'name', ''));
begin
  if coalesce(meta->>'age_13_plus', '') <> 'true' then
    raise exception 'Cadastro recusado: é preciso ter 13 anos ou mais.';
  end if;
  if coalesce(meta->>'consent_version', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Cadastro recusado: é preciso aceitar a Política de Privacidade.';
  end if;

  insert into public.profiles (id, name, consent_version, consent_at, age_13_plus)
  values (new.id, nome, meta->>'consent_version', now(), true);
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();


-- 4.2 Perfil: garante que só nome/bio/foto/silenciar mudam,
--     e que a foto aponta para um endereço permitido.
create or replace function public.proteger_perfil()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.id              := old.id;
  new.created_at      := old.created_at;
  new.consent_version := old.consent_version;
  new.consent_at      := old.consent_at;
  new.age_13_plus     := old.age_13_plus;
  -- papel só muda pelo SQL Editor do painel (usuário postgres)
  if current_user not in ('postgres', 'supabase_admin') then
    new.role := old.role;
  end if;
  new.name       := btrim(new.name);
  new.updated_at := now();
  if not public.url_imagem_ok(new.avatar_url) then
    raise exception 'Endereço de imagem não permitido.';
  end if;
  return new;
end;
$$;

drop trigger if exists antes_de_mudar_perfil on public.profiles;
create trigger antes_de_mudar_perfil
  before update on public.profiles
  for each row execute function public.proteger_perfil();


-- 4.3 Posts: autor certo, tags válidas, imagens seguras, só admin
--     suspende ou publica novidades, limite contra spam.
create or replace function public.proteger_post()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  admin boolean := public.is_admin();
  tags_ok text[];
begin
  if tg_op = 'INSERT' then
    new.author_id  := (select auth.uid());
    new.created_at := now();
    if new.author_id is null then
      raise exception 'É preciso estar logado.';
    end if;
    if not admin then
      new.suspended := false;
      if new.type = 'novidades' then
        raise exception 'Só o administrador publica novidades.';
      end if;
      -- anti-spam: no máximo 20 posts por hora por pessoa
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

drop trigger if exists antes_de_gravar_post on public.posts;
create trigger antes_de_gravar_post
  before insert or update on public.posts
  for each row execute function public.proteger_post();


-- 4.4 Novo build/guia: avisa quem segue o autor (e guarda só as 50
--     notificações mais novas de cada pessoa).
create or replace function public.notificar_seguidores()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.type in ('builds', 'guias') and not new.suspended then
    insert into public.notifications (user_id, type, from_user_id, post_id)
    select f.follower_id, 'new_post', new.author_id, new.id
    from public.follows f
    where f.followed_id = new.author_id;

    delete from public.notifications n
    where n.user_id in (select follower_id from public.follows where followed_id = new.author_id)
      and n.id not in (
        select id from public.notifications n2
        where n2.user_id = n.user_id
        order by created_at desc limit 50
      );
  end if;
  return null;
end;
$$;

drop trigger if exists depois_de_criar_post on public.posts;
create trigger depois_de_criar_post
  after insert on public.posts
  for each row execute function public.notificar_seguidores();


-- 4.5 Notificação: o dono só pode marcar como lida.
create or replace function public.proteger_notificacao()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.id := old.id; new.user_id := old.user_id; new.type := old.type;
  new.from_user_id := old.from_user_id; new.post_id := old.post_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists antes_de_mudar_notificacao on public.notifications;
create trigger antes_de_mudar_notificacao
  before update on public.notifications
  for each row execute function public.proteger_notificacao();


-- =====================================================================
-- REGRAS DE ACESSO (RLS)
-- =====================================================================

-- PERFIS: qualquer um vê nome/bio/foto. Cada um só altera o seu.
drop policy if exists "perfis: leitura publica" on public.profiles;
create policy "perfis: leitura publica" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "perfis: dono altera" on public.profiles;
create policy "perfis: dono altera" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- POSTS: público vê os não suspensos; autor vê os seus; admin vê tudo.
drop policy if exists "posts: leitura" on public.posts;
create policy "posts: leitura" on public.posts
  for select to anon, authenticated
  using (not suspended or author_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "posts: criar" on public.posts;
create policy "posts: criar" on public.posts
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (type <> 'novidades' or (select public.is_admin())));

drop policy if exists "posts: editar" on public.posts;
create policy "posts: editar" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()))
  with check (author_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "posts: apagar" on public.posts;
create policy "posts: apagar" on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- SEGUIDORES: cada um vê só as próprias ligações (contagens via função).
drop policy if exists "follows: ver as minhas" on public.follows;
create policy "follows: ver as minhas" on public.follows
  for select to authenticated
  using (follower_id = (select auth.uid()) or followed_id = (select auth.uid()));

drop policy if exists "follows: seguir" on public.follows;
create policy "follows: seguir" on public.follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()));

drop policy if exists "follows: deixar de seguir" on public.follows;
create policy "follows: deixar de seguir" on public.follows
  for delete to authenticated
  using (follower_id = (select auth.uid()));

-- NOTIFICAÇÕES: só o dono vê, marca como lida ou apaga.
drop policy if exists "notif: ver as minhas" on public.notifications;
create policy "notif: ver as minhas" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "notif: marcar lida" on public.notifications;
create policy "notif: marcar lida" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "notif: apagar" on public.notifications;
create policy "notif: apagar" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));


-- =====================================================================
-- PERMISSÕES POR COLUNA (segunda camada além do RLS)
-- =====================================================================
revoke all on public.profiles, public.posts, public.follows, public.notifications from anon, authenticated;

grant select (id, name, bio, avatar_url, role, created_at) on public.profiles to anon, authenticated;
grant update (name, bio, avatar_url, notif_muted)          on public.profiles to authenticated;

grant select on public.posts to anon, authenticated;
grant insert (id, type, title, descr, emoji, tags, card_image, sections, youtube_url, youtube_embeddable)
  on public.posts to authenticated;
grant update (type, title, descr, emoji, tags, card_image, sections, youtube_url, youtube_embeddable, suspended)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;

grant select, insert, delete on public.follows to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read)  on public.notifications to authenticated;


-- =====================================================================
-- FUNÇÕES QUE O SITE CHAMA (RPC)
-- =====================================================================

-- Meus dados privados (silenciar notificações, consentimento)
create or replace function public.meu_perfil()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(p) from public.profiles p where p.id = (select auth.uid());
$$;

-- Contagem pública de seguidores/seguindo (sem revelar QUEM segue)
create or replace function public.contagem_seguidores(alvo uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'seguidores', (select count(*) from public.follows where followed_id = alvo),
    'seguindo',   (select count(*) from public.follows where follower_id = alvo)
  );
$$;

-- LGPD art. 18 II e V: exportar tudo o que o site guarda da pessoa
create or replace function public.exportar_meus_dados()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  eu uuid := (select auth.uid());
begin
  if eu is null then raise exception 'É preciso estar logado.'; end if;
  return jsonb_build_object(
    'gerado_em', now(),
    'conta', (select jsonb_build_object(
                'id', u.id, 'email', u.email, 'criada_em', u.created_at,
                'email_confirmado_em', u.email_confirmed_at,
                'ultimo_login_em', u.last_sign_in_at)
              from auth.users u where u.id = eu),
    'perfil', (select to_jsonb(p) from public.profiles p where p.id = eu),
    'posts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at)
                       from public.posts p where p.author_id = eu), '[]'::jsonb),
    'seguindo', coalesce((select jsonb_agg(jsonb_build_object('perfil', f.followed_id, 'desde', f.created_at))
                          from public.follows f where f.follower_id = eu), '[]'::jsonb),
    'total_de_seguidores', (select count(*) from public.follows where followed_id = eu),
    'notificacoes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
                              from public.notifications n where n.user_id = eu), '[]'::jsonb)
  );
end;
$$;

-- LGPD art. 18 VI: excluir a conta e tudo ligado a ela.
-- (As imagens do Storage são apagadas pelo site antes de chamar esta função.)
create or replace function public.excluir_minha_conta()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  eu uuid := (select auth.uid());
begin
  if eu is null then raise exception 'É preciso estar logado.'; end if;
  delete from auth.users where id = eu;   -- apaga perfil, posts, seguidores e notificações (cascade)
end;
$$;

-- Quem pode chamar o quê
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin()                to anon, authenticated;
grant execute on function public.url_imagem_ok(text)       to anon, authenticated;
grant execute on function public.secoes_ok(jsonb)          to anon, authenticated;
grant execute on function public.contagem_seguidores(uuid) to anon, authenticated;
grant execute on function public.meu_perfil()              to authenticated;
grant execute on function public.exportar_meus_dados()     to authenticated;
grant execute on function public.excluir_minha_conta()     to authenticated;


-- =====================================================================
-- STORAGE (imagens dos posts e fotos de perfil)
-- Balde "imagens": leitura pública; cada pessoa só envia/apaga dentro
-- da própria pasta (imagens/<id-da-pessoa>/...). Até 2 MB, só JPG,
-- PNG, WEBP e GIF. SVG fica de fora porque pode carregar script.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens', 'imagens', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "imagens: enviar na minha pasta" on storage.objects;
create policy "imagens: enviar na minha pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imagens' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "imagens: listar a minha pasta" on storage.objects;
create policy "imagens: listar a minha pasta" on storage.objects
  for select to authenticated
  using (bucket_id = 'imagens' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "imagens: apagar da minha pasta" on storage.objects;
create policy "imagens: apagar da minha pasta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imagens' and (storage.foldername(name))[1] = (select auth.uid())::text);
