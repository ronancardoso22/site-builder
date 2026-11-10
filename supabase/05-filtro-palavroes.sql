-- =====================================================================
-- FILTRO DE PALAVRÕES — 10/11/2026
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema (não apaga palavras que você
-- adicionou).
--
-- O que faz:
--  1. Cria a tabela "palavroes" com a lista de palavras proibidas.
--     Para adicionar/remover palavras depois: Table Editor > palavroes.
--     Escreva a palavra em minúsculas (com ou sem acento). Termine com
--     * para pegar tudo que começa com ela (ex.: caralh* pega caralho,
--     caralhada...). O plural com "s" já é pego sozinho.
--  2. Todo palavrão em posts (título, descrição, seções) e em perfis
--     (nome e bio) vira ***** — direto no banco, ao salvar. Não dá para
--     burlar pelo navegador.
--  3. Pega variações: maiúsculas, acentos (cuzão/cuzao), letras
--     repetidas (porrrra), números/símbolos no lugar de letras
--     (p0rr4, m3rd@, $hit) e pontos/traços entre letras (m.e.r.d.a).
--  4. Só pega a palavra inteira: "disputa", "computador" e "curar"
--     continuam normais.
--  5. No final, limpa os posts e perfis que já existem.
--
-- SEGURANÇA: a lista fica trancada (RLS ligado, sem regras); só o
-- painel do Supabase lê e muda. As funções não podem ser chamadas
-- pelo site.
-- =====================================================================

-- 1) Lista de palavras
create table if not exists public.palavroes (
  palavra   text primary key
            check (palavra ~ '^[a-záàâãäéèêëíìîïóòôõöúùûüç]{2,30}\*?$'),
  criado_em timestamptz not null default now()
);
alter table public.palavroes enable row level security;
revoke all on public.palavroes from anon, authenticated;

insert into public.palavroes (palavra) values
  -- português
  ('porra'), ('caralh*'), ('krl'), ('krlh'), ('crl'), ('cacete'),
  ('merda'), ('merdinha'), ('bosta'), ('cu'), ('cuzão'), ('cuzinho'), ('cuzuda'),
  ('foda'), ('fodase'), ('foder'), ('fodeu'), ('fodido'), ('fodida'), ('fodendo'), ('fudido'), ('fudida'),
  ('fdp'), ('pqp'), ('vsf'), ('tnc'), ('vtnc'), ('tmnc'), ('vtmnc'),
  ('puta'), ('puto'), ('putaria'), ('putinha'), ('putona'),
  ('buceta'), ('boceta'), ('xoxota'), ('xereca'), ('piroca'), ('caceta'),
  ('punheta'), ('punheteiro'), ('siririca'), ('boquete'), ('broxa'),
  ('arrombado'), ('arrombada'), ('corno'), ('cornudo'), ('vagabunda'), ('vagabundo'), ('vadia'),
  ('viado'), ('viadinho'), ('bicha'), ('sapatão'), ('traveco'),
  ('desgraçado'), ('desgraçada'), ('filhodaputa'), ('escroto'), ('escrota'),
  ('retardado'), ('retardada'), ('babaca'), ('otário'), ('otária'),
  ('cacetada'), ('porrada'),
  -- inglês (comum em jogos)
  ('fuck*'), ('fck'), ('wtf'), ('stfu'), ('shit'), ('bullshit'), ('bitch'), ('asshole'),
  ('cunt'), ('dick'), ('pussy'), ('motherfucker'), ('nigger'), ('nigga'), ('faggot'), ('whore'), ('slut')
on conflict (palavra) do nothing;


-- 2) Palavra da lista "normalizada": minúsculas, sem acento, números
--    e símbolos trocados por letras (p0rr4 -> porra).
create or replace function public.normalizar_texto(t text)
returns text
language sql immutable set search_path = ''
as $$
  select translate(lower(t),
    'áàâãäåéèêëíìîïóòôõöúùûüçñý@4310$57',
    'aaaaaaeeeeiiiiooooouuuucnyaaeiosst');
$$;

-- Uma palavra da lista vira um pedaço de expressão regular:
--  - cada letra aceita maiúscula, acentos e números/símbolos (a = á, @, 4...)
--  - cada letra pode repetir (porrrra) e ter . _ - no meio (m.e.r.d.a)
--  - "s" no final é aceito (plural); "*" no final aceita qualquer final
create or replace function public.palavrao_regex(p text)
returns text
language sql immutable set search_path = ''
as $$
  select string_agg(
           case l
             when 'a' then '[aáàâãäåAÁÀÂÃÄÅ@4]'
             when 'e' then '[eéèêëEÉÈÊË3]'
             when 'i' then '[iíìîïIÍÌÎÏ1]'
             when 'o' then '[oóòôõöOÓÒÔÕÖ0]'
             when 'u' then '[uúùûüUÚÙÛÜ]'
             when 'c' then '[cçCÇ]'
             when 's' then '[sS$5]'
             when 't' then '[tT7]'
             when 'n' then '[nñNÑ]'
             else '[' || l || upper(l) || ']'
           end || '+', '[._-]*' order by n)
         || case when p like '%*' then '[a-zA-Z0-9áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ]*' else '' end
         || '[sS$5]*'
  from regexp_split_to_table(public.normalizar_texto(rtrim(p, '*')), '') with ordinality as x(l, n)
  where l ~ '^[a-z]$';
$$;

-- A expressão completa, montada a partir da tabela. Só pega a palavra
-- inteira: não pode ter letra/número grudado antes nem depois.
create or replace function public.palavroes_padrao()
returns text
language sql stable security definer set search_path = ''
as $$
  select '(?<![a-zA-Z0-9áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ])(?:'
         || string_agg(public.palavrao_regex(palavra), '|' order by char_length(palavra) desc, palavra)
         || ')(?![a-zA-Z0-9áàâãäåéèêëíìîïóòôõöúùûüçñýÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ])'
  from public.palavroes;
$$;

-- Troca cada palavrão do texto por ***** (uma passada só, rápido)
create or replace function public.filtrar_palavroes(t text, padrao text)
returns text
language sql immutable set search_path = ''
as $$
  select case when t is null or padrao is null then t
              else regexp_replace(t, padrao, '*****', 'g') end;
$$;

-- Percorre as seções do post. Não mexe em endereços de imagem/vídeo.
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
      if (j #>> '{}') ~* '^(https?://|imagens/)' then
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


-- 3) Gatilhos (rodam depois das outras regras, por ordem alfabética)
create or replace function public.filtro_palavroes_post()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  padrao text := public.palavroes_padrao();
begin
  new.title    := left(public.filtrar_palavroes(new.title, padrao), 200);
  new.descr    := left(public.filtrar_palavroes(new.descr, padrao), 1000);
  new.sections := public.filtrar_palavroes_jsonb(new.sections, padrao);
  return new;
end;
$$;

drop trigger if exists filtro_palavroes_post on public.posts;
create trigger filtro_palavroes_post
  before insert or update on public.posts
  for each row execute function public.filtro_palavroes_post();

create or replace function public.filtro_palavroes_perfil()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  padrao text := public.palavroes_padrao();
begin
  new.name := left(public.filtrar_palavroes(new.name, padrao), 40);
  new.bio  := left(public.filtrar_palavroes(new.bio, padrao), 260);
  return new;
end;
$$;

drop trigger if exists filtro_palavroes_perfil on public.profiles;
create trigger filtro_palavroes_perfil
  before insert or update on public.profiles
  for each row execute function public.filtro_palavroes_perfil();

-- 4) Ninguém de fora chama estas funções (nem pelo site)
revoke all on function public.normalizar_texto(text) from public, anon, authenticated;
revoke all on function public.palavrao_regex(text) from public, anon, authenticated;
revoke all on function public.palavroes_padrao() from public, anon, authenticated;
revoke all on function public.filtrar_palavroes(text, text) from public, anon, authenticated;
revoke all on function public.filtrar_palavroes_jsonb(jsonb, text) from public, anon, authenticated;
revoke all on function public.filtro_palavroes_post() from public, anon, authenticated;
revoke all on function public.filtro_palavroes_perfil() from public, anon, authenticated;


-- 5) Limpa o que já existe (só as linhas que têm palavrão).
--    Se alguma linha der erro, ela é pulada e o resto continua.
do $$
declare
  padrao text := public.palavroes_padrao();
  r record;
  pulados int := 0;
begin
  for r in select id from public.posts
           where title is distinct from public.filtrar_palavroes(title, padrao)
              or descr is distinct from public.filtrar_palavroes(descr, padrao)
              or sections is distinct from public.filtrar_palavroes_jsonb(sections, padrao)
  loop
    begin
      update public.posts set title = title where id = r.id;
    exception when others then
      pulados := pulados + 1;
    end;
  end loop;
  for r in select id from public.profiles
           where name is distinct from public.filtrar_palavroes(name, padrao)
              or bio is distinct from public.filtrar_palavroes(bio, padrao)
  loop
    begin
      update public.profiles set name = name where id = r.id;
    exception when others then
      pulados := pulados + 1;
    end;
  end loop;
  if pulados > 0 then
    raise notice 'Linhas puladas: % (rode este arquivo de novo daqui a pouco).', pulados;
  end if;
end;
$$;

select 'Filtro de palavrões instalado. Palavras na lista: ' || count(*) as resultado
from public.palavroes;
