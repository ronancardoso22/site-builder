-- =====================================================================
-- ADMIN APAGA AS IMAGENS DOS POSTS QUE ELE APAGA — 20/11/2026
-- (auditoria de 20/11/2026, item 4)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
-- (É o SQL EDITOR, não o editor de Edge Functions.)
-- Pode rodar de novo sem problema. Não apaga nada.
--
-- O que faz:
--  Antes, cada pessoa só podia apagar arquivos da própria pasta, inclusive
--  o admin. Quando o admin apagava o post ofensivo de outra pessoa, as
--  imagens continuavam online pelo endereço direto e ocupando espaço.
--  Agora o admin também pode apagar (e listar, que o Storage exige junto)
--  arquivos de qualquer pasta, nos baldes "imagens" e "videos".
--  As outras pessoas continuam iguais: só mexem na própria pasta.
-- =====================================================================

-- Imagens
drop policy if exists "imagens: listar a minha pasta" on storage.objects;
create policy "imagens: listar a minha pasta" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imagens'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

drop policy if exists "imagens: apagar da minha pasta" on storage.objects;
create policy "imagens: apagar da minha pasta" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imagens'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

-- Vídeos (apagar já permitia o admin; faltava listar)
drop policy if exists "videos: listar a minha pasta" on storage.objects;
create policy "videos: listar a minha pasta" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'videos'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

select 'Admin agora apaga as imagens dos posts que apagar.' as resultado;
