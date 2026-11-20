-- =====================================================================
-- CURTIDAS (LIKES) NAS BUILDS E GUIAS — 19/11/2026
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
-- (É o SQL EDITOR, não o editor de Edge Functions.)
-- Pode rodar de novo sem problema.
--
-- O que faz:
--  1. Cria a tabela "post_likes": uma linha = uma pessoa curtiu um post.
--     A chave (user_id, post_id) garante 1 curtida por conta por post.
--     Não há limite de posts diferentes.
--  2. Só builds e guias podem ser curtidos (notícias não), só posts
--     não suspensos, e ninguém curte o próprio post (senão o autor
--     subiria o próprio post no ranking da página inicial).
--  3. Limite anti-abuso: no máximo 200 curtidas por hora por conta.
--  4. Cada pessoa só vê, cria e apaga as PRÓPRIAS curtidas (RLS).
--     Ninguém consegue descobrir QUEM curtiu um post: o site só recebe
--     os números (função curtidas_dos_posts).
--  5. "Baixar meus dados" (LGPD) passa a incluir as curtidas.
--  Ao apagar um post ou uma conta, as curtidas somem junto (cascade).
-- =====================================================================

-- 1) Tabela
create table if not exists public.post_likes (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  post_id    text not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- Índice para contar rápido por post (e as da semana)
create index if not exists post_likes_post_idx on public.post_likes (post_id, created_at desc);

alter table public.post_likes enable row level security;

-- 2) Regras (RLS): cada um só mexe no que é seu
drop policy if exists "likes: ver as minhas" on public.post_likes;
create policy "likes: ver as minhas" on public.post_likes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "likes: curtir" on public.post_likes;
create policy "likes: curtir" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "likes: descurtir" on public.post_likes;
create policy "likes: descurtir" on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- 3) Permissões por coluna (segunda camada). O site só manda o post_id;
--    quem é o usuário e a data vêm do servidor. Visitante sem login: nada.
revoke all on public.post_likes from anon, authenticated;
grant select (post_id, created_at) on public.post_likes to authenticated;
grant insert (post_id)             on public.post_likes to authenticated;
grant delete                       on public.post_likes to authenticated;

-- 4) Conferência antes de gravar cada curtida (roda no servidor)
create or replace function public.antes_de_curtir()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  alvo record;
begin
  new.user_id    := (select auth.uid());   -- sempre a conta logada
  new.created_at := now();                 -- sempre a hora do servidor
  if new.user_id is null then
    raise exception 'É preciso estar logado para curtir.';
  end if;

  select p.type, p.author_id, p.suspended into alvo
    from public.posts p where p.id = new.post_id;
  if not found or alvo.suspended then
    raise exception 'Este post não está disponível.';
  end if;
  if alvo.type not in ('builds', 'guias') then
    raise exception 'Só builds e guias podem ser curtidos.';
  end if;
  if alvo.author_id = new.user_id then
    raise exception 'Você não pode curtir o próprio post.';
  end if;

  if (select count(*) from public.post_likes l
      where l.user_id = new.user_id and l.created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Muitas curtidas em pouco tempo. Tente mais tarde.';
  end if;
  return new;
end;
$$;

drop trigger if exists antes_de_curtir on public.post_likes;
create trigger antes_de_curtir
  before insert on public.post_likes
  for each row execute function public.antes_de_curtir();

-- 5) Números públicos: total de curtidas e curtidas dos últimos 7 dias
--    de cada build/guia visível. Devolve só números, nunca quem curtiu.
create or replace function public.curtidas_dos_posts()
returns table (post_id text, total bigint, semana bigint)
language sql stable security definer set search_path = ''
as $$
  select l.post_id,
         count(*) as total,
         count(*) filter (where l.created_at > now() - interval '7 days') as semana
    from public.post_likes l
    join public.posts p on p.id = l.post_id
   where not p.suspended and p.type in ('builds', 'guias')
   group by l.post_id;
$$;

-- 6) LGPD: "Baixar meus dados" agora inclui as curtidas
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
    'curtidas', coalesce((select jsonb_agg(jsonb_build_object('post', l.post_id, 'em', l.created_at) order by l.created_at)
                          from public.post_likes l where l.user_id = eu), '[]'::jsonb),
    'notificacoes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
                              from public.notifications n where n.user_id = eu), '[]'::jsonb)
  );
end;
$$;

-- 7) Quem pode chamar o quê
revoke all on function public.antes_de_curtir()      from public, anon, authenticated;
revoke all on function public.curtidas_dos_posts()   from public;
grant execute on function public.curtidas_dos_posts()  to anon, authenticated;
revoke all on function public.exportar_meus_dados()  from public, anon;
grant execute on function public.exportar_meus_dados() to authenticated;

-- Pronto. Para conferir: Table Editor > post_likes (começa vazia).
