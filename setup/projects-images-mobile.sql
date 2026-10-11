-- Upgrade only image formats; workspace authorization and privacy stay unchanged.
begin;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'project-images' and not public) then
    raise exception 'Configure the private project-images bucket first.';
  end if;
end $$;

update storage.buckets
set allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg']
where id = 'project-images' and public = false;

alter policy project_images_insert on storage.objects
with check (
  bucket_id = 'project-images'
  and (storage.foldername(name))[1] = (select public.project_image_workspace())
  and name ~ '^[a-f0-9]{64}/[A-Za-z0-9_-]{1,100}/[a-f0-9-]{36}\.(webp|png|jpg)$'
);

alter policy project_images_write_guard on storage.objects
with check (bucket_id <> 'project-images' or (
  (storage.foldername(name))[1] = (select public.project_image_workspace())
  and name ~ '^[a-f0-9]{64}/[A-Za-z0-9_-]{1,100}/[a-f0-9-]{36}\.(webp|png|jpg)$'
));

commit;
