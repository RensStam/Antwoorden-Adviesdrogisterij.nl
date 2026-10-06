-- Antwoorden Adviesdrogisterij.nl: centrale, versleutelde opslag
--
-- Uitvoeren in Supabase: SQL Editor -> New query -> dit hele bestand plakken -> Run.
-- Mag vaker worden uitgevoerd (bijv. na een update); bestaande gegevens blijven staan.
--
-- Hoe het werkt: de app versleutelt alles in de browser met het wachtwoord (AES-256-GCM).
-- De server bewaart alleen die onleesbare data plus een hash van een toegangsbewijs dat
-- ook uit het wachtwoord wordt afgeleid. Het wachtwoord zelf komt nooit op de server.
-- De tabel is niet rechtstreeks leesbaar; alles gaat via de functies hieronder.

create table if not exists public.vault (
  id smallint primary key default 1 check (id = 1),  -- precies één kluis voor het hele team
  salt text not null,
  iter integer not null,
  token_hash text not null,
  data text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Beheerder: alleen wie het beheerderswachtwoord heeft, kan het gewone wachtwoord wijzigen.
alter table public.vault add column if not exists admin_salt text;
alter table public.vault add column if not exists admin_hash text;
-- Beveiligd vak (de instructies): leesbaar voor iedereen met het wachtwoord, opslaan alleen met het beheerderswachtwoord.
alter table public.vault add column if not exists locked text;

alter table public.vault enable row level security;  -- zonder policies: niemand kan de tabel direct lezen
revoke all on table public.vault from public, anon, authenticated;

-- Controle van het toegangsbewijs (intern). Bij een fout 1 seconde wachten tegen raden.
create or replace function public._vault_check(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or not exists (
    select 1 from public.vault
    where id = 1 and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) then
    perform pg_sleep(1);
    raise exception 'invalid_token';
  end if;
end $$;

-- Bestaat de kluis al? Geeft alleen de (openbare) salt terug, nooit de data.
create or replace function public.vault_info() returns json
language sql security definer set search_path = '' stable as $$
  select coalesce(
    (select json_build_object('exists', true, 'salt', salt, 'iter', iter,
       'admin', admin_hash is not null, 'admin_salt', admin_salt) from public.vault where id = 1),
    json_build_object('exists', false));
$$;

-- Eerste keer: kluis aanmaken (alleen als er nog geen is).
create or replace function public.vault_create(p_salt text, p_iter integer, p_token text, p_data text) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.vault where id = 1) then raise exception 'already_exists'; end if;
  if length(p_token) <> 64 or p_iter < 100000 then raise exception 'invalid_input'; end if;
  insert into public.vault (id, salt, iter, token_hash, data, version)
  values (1, p_salt, p_iter, encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), p_data, 1);
  return 1;
end $$;

-- Ophalen. Met p_known_version = huidige versie komt alleen het versienummer terug (scheelt dataverkeer).
create or replace function public.vault_load(p_token text, p_known_version bigint default null) returns json
language plpgsql security definer set search_path = '' as $$
declare v public.vault;
begin
  perform public._vault_check(p_token);
  select * into v from public.vault where id = 1;
  if p_known_version is not null and p_known_version = v.version then
    return json_build_object('version', v.version);
  end if;
  return json_build_object('version', v.version, 'data', v.data, 'locked', v.locked, 'updated_at', v.updated_at);
end $$;

-- Opslaan. Faalt met version_conflict als iemand anders intussen heeft opgeslagen (de app voegt dan samen).
create or replace function public.vault_save(p_token text, p_data text, p_version bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare nv bigint;
begin
  perform public._vault_check(p_token);
  update public.vault set data = p_data, version = version + 1, updated_at = now()
  where id = 1 and version = p_version
  returning version into nv;
  if nv is null then raise exception 'version_conflict'; end if;
  return nv;
end $$;

-- Beheerderswachtwoord instellen (alleen de allereerste keer; daarna alleen via SQL te wissen, zie onderaan).
create or replace function public.vault_set_admin(p_token text, p_admin_salt text, p_admin_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._vault_check(p_token);
  if length(p_admin_token) <> 64 then raise exception 'invalid_input'; end if;
  update public.vault set admin_salt = p_admin_salt,
    admin_hash = encode(sha256(convert_to(p_admin_token, 'UTF8')), 'hex')
  where id = 1 and admin_hash is null;
  if not found then raise exception 'admin_exists'; end if;
end $$;

-- Controle van het beheerderswachtwoord (intern). Bij een fout 1 seconde wachten tegen raden.
create or replace function public._admin_check(p_admin_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vault where id = 1 and admin_hash is not null
                 and admin_hash = encode(sha256(convert_to(coalesce(p_admin_token, ''), 'UTF8')), 'hex')) then
    perform pg_sleep(1);
    raise exception 'invalid_admin';
  end if;
end $$;

-- Wachtwoord wijzigen: alleen met het beheerderswachtwoord. Alles wordt opnieuw versleuteld opgeslagen
-- (ook het beveiligde vak, want de sleutel verandert mee).
drop function if exists public.vault_rekey(text, text, integer, text, text, bigint);
drop function if exists public.vault_rekey(text, text, text, integer, text, text, bigint);
create or replace function public.vault_rekey(p_token text, p_admin_token text, p_salt text, p_iter integer, p_new_token text, p_data text, p_version bigint, p_locked text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare nv bigint;
begin
  perform public._vault_check(p_token);
  perform public._admin_check(p_admin_token);
  if length(p_new_token) <> 64 or p_iter < 100000 then raise exception 'invalid_input'; end if;
  if p_locked is null and exists (select 1 from public.vault where id = 1 and locked is not null) then raise exception 'locked_required'; end if;
  update public.vault set salt = p_salt, iter = p_iter,
    token_hash = encode(sha256(convert_to(p_new_token, 'UTF8')), 'hex'),
    data = p_data, locked = coalesce(p_locked, locked), version = version + 1, updated_at = now()
  where id = 1 and version = p_version
  returning version into nv;
  if nv is null then raise exception 'version_conflict'; end if;
  return nv;
end $$;

-- Beheerderswachtwoord controleren (om het beveiligde vak in de app te ontgrendelen). Geeft geen gegevens terug.
create or replace function public.vault_check_admin(p_token text, p_admin_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public._vault_check(p_token);
  perform public._admin_check(p_admin_token);
  return true;
end $$;

-- Beveiligd vak opslaan (de instructies): alleen met het gewone én het beheerderswachtwoord.
create or replace function public.vault_save_locked(p_token text, p_admin_token text, p_locked text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare nv bigint;
begin
  perform public._vault_check(p_token);
  perform public._admin_check(p_admin_token);
  if p_locked is null or length(p_locked) > 5000000 then raise exception 'invalid_input'; end if;
  update public.vault set locked = p_locked, version = version + 1, updated_at = now() where id = 1
  returning version into nv;
  return nv;
end $$;

-- Alleen controleren of een toegangsbewijs klopt (gebruikt door de mailkoppeling, geeft geen gegevens terug).
create or replace function public.vault_verify(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public._vault_check(p_token);
  return true;
end $$;

-- Rechten: de app (rol anon) mag alleen deze functies aanroepen.
revoke all on function public._vault_check(text) from public, anon, authenticated;
revoke all on function public.vault_info() from public;
revoke all on function public.vault_create(text, integer, text, text) from public;
revoke all on function public.vault_load(text, bigint) from public;
revoke all on function public.vault_save(text, text, bigint) from public;
revoke all on function public.vault_verify(text) from public;
revoke all on function public.vault_set_admin(text, text, text) from public;
revoke all on function public._admin_check(text) from public, anon, authenticated;
revoke all on function public.vault_rekey(text, text, text, integer, text, text, bigint, text) from public;
revoke all on function public.vault_check_admin(text, text) from public;
revoke all on function public.vault_save_locked(text, text, text) from public;
grant execute on function public.vault_info() to anon, authenticated;
grant execute on function public.vault_create(text, integer, text, text) to anon, authenticated;
grant execute on function public.vault_load(text, bigint) to anon, authenticated;
grant execute on function public.vault_save(text, text, bigint) to anon, authenticated;
grant execute on function public.vault_verify(text) to anon, authenticated;
grant execute on function public.vault_set_admin(text, text, text) to anon, authenticated;
grant execute on function public.vault_rekey(text, text, text, integer, text, text, bigint, text) to anon, authenticated;
grant execute on function public.vault_check_admin(text, text) to anon, authenticated;
grant execute on function public.vault_save_locked(text, text, text) to anon, authenticated;

-- Wachtwoord kwijt? Dan kan niemand de gegevens meer lezen. Kluis wissen (daarna in de app
-- een nieuw wachtwoord kiezen en de back-up terugzetten):
--   delete from public.vault;
--
-- Beheerderswachtwoord kwijt? Wissen (daarna in de app opnieuw instellen):
--   update public.vault set admin_hash = null, admin_salt = null;
--
-- Beveiliging van de instructies opheffen (ze staan dan weer gewoon in de kluis; de app gebruikt die versie):
--   update public.vault set locked = null;
