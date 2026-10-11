-- Run once in the SQL Editor of the Supabase project used by env.js.
-- Images remain private. The existing widget passcode authorizes its workspace.
-- Only this new bucket and its named policies are affected.
begin;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'project-images' and public) then
    raise exception 'project-images already exists as a public bucket. Review it before continuing.';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-images', 'project-images', false, 6291456, array['image/webp'])
on conflict (id) do nothing;

-- Base64 is only the UTF-8 transport encoding, not encryption. Requests use HTTPS.
-- Recompute the existing workspace hash instead of trusting a supplied folder ID.
create or replace function public.project_image_workspace()
returns text language plpgsql stable security invoker
set search_path = pg_catalog, extensions
as $$
declare
  proof text;
  passcode text;
begin
  proof := coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-widget-passcode', '');
  if proof = '' or length(proof) > 4000 then return null; end if;
  passcode := convert_from(decode(proof, 'base64'), 'UTF8');
  if passcode = '' then return null; end if;
  return encode(extensions.digest('bora-widget-v1:' || passcode, 'sha256'), 'hex');
exception when others then
  return null;
end;
$$;

revoke all on function public.project_image_workspace() from public;
grant execute on function public.project_image_workspace() to anon, authenticated;

drop policy if exists project_images_insert on storage.objects;
create policy project_images_insert on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'project-images'
  and (storage.foldername(name))[1] = (select public.project_image_workspace())
  and name ~ '^[a-f0-9]{64}/[A-Za-z0-9_-]{1,100}/[a-f0-9-]{36}\.webp$'
);

drop policy if exists project_images_select on storage.objects;
create policy project_images_select on storage.objects for select to anon, authenticated
using (
  bucket_id = 'project-images'
  and (storage.foldername(name))[1] = (select public.project_image_workspace())
);

-- Other buckets may already have permissive policies. These guards keep those
-- policies from accidentally opening this bucket, and leave other buckets alone.
drop policy if exists project_images_read_guard on storage.objects;
create policy project_images_read_guard on storage.objects as restrictive for select to anon, authenticated
using (bucket_id <> 'project-images' or (storage.foldername(name))[1] = (select public.project_image_workspace()));

drop policy if exists project_images_write_guard on storage.objects;
create policy project_images_write_guard on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'project-images' or (
  (storage.foldername(name))[1] = (select public.project_image_workspace())
  and name ~ '^[a-f0-9]{64}/[A-Za-z0-9_-]{1,100}/[a-f0-9-]{36}\.webp$'
));

drop policy if exists project_images_no_update on storage.objects;
create policy project_images_no_update on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'project-images') with check (bucket_id <> 'project-images');

drop policy if exists project_images_no_delete on storage.objects;
create policy project_images_no_delete on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'project-images');

-- No UPDATE/DELETE policy: resizing/removing only changes the document reference.
-- Signed read URLs expire after one hour and are never stored in project JSON.
commit;
