create extension if not exists pgcrypto;

drop table if exists notifications cascade;
drop table if exists streaks cascade;
drop table if exists moods cascade;
drop table if exists message_reactions cascade;
drop table if exists messages cascade;
drop table if exists pulses cascade;
drop table if exists invite_codes cascade;
drop table if exists partnerships cascade;
drop table if exists users cascade;

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Love',
  avatar_url text,
  partner_id uuid,
  onboarding_complete boolean not null default false,
  timezone text not null default 'UTC',
  onesignal_external_id text generated always as (id::text) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
  add constraint users_partner_id_fkey foreign key (partner_id) references users(id) on delete set null,
  add constraint users_not_own_partner check (partner_id is null or partner_id <> id);

create unique index users_email_unique_idx on users (lower(email)) where email is not null;
create index users_partner_id_idx on users (partner_id) where partner_id is not null;

create table partnerships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references users(id) on delete cascade,
  user_b uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint partnerships_distinct_users check (user_a <> user_b)
);

create unique index partnerships_pair_unique_idx
on partnerships (least(user_a, user_b), greatest(user_a, user_b))
where status = 'active';

create table invite_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  used_by uuid references users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index invite_codes_owner_idx on invite_codes(owner_id);
create index invite_codes_lookup_idx on invite_codes(code) where used_at is null;

create table pulses (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  emotion text not null default 'Thinking of you',
  intensity int not null default 3 check (intensity between 1 and 5),
  note text,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pulses_distinct_users check (sender_id <> receiver_id)
);

create index pulses_pair_created_idx on pulses (sender_id, receiver_id, created_at desc);
create index pulses_receiver_unseen_idx on pulses (receiver_id, created_at desc) where seen_at is null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  body text,
  image_url text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_content_check check (body is not null or image_url is not null),
  constraint messages_distinct_users check (sender_id <> receiver_id)
);

create index messages_pair_created_idx on messages (sender_id, receiver_id, created_at desc);
create index messages_receiver_unread_idx on messages (receiver_id, created_at desc) where read_at is null;

create table message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table moods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  mood_key text not null,
  emoji text not null,
  color text not null,
  note text,
  mood_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, mood_date)
);

create index moods_user_date_idx on moods (user_id, mood_date desc);

create table streaks (
  user_id uuid not null references users(id) on delete cascade,
  partner_id uuid not null references users(id) on delete cascade,
  connection_streak int not null default 0,
  pulse_streak int not null default 0,
  last_connected_on date,
  last_pulse_on date,
  milestone_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, partner_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  type text not null check (type in ('pulse', 'message', 'mood', 'streak', 'invite')),
  title text not null,
  body text not null,
  provider text not null default 'onesignal',
  provider_response jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on notifications (user_id, created_at desc);

create or replace function is_partner(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users u
    where u.id = auth.uid()
      and (u.partner_id = target or u.id = target)
  );
$$;

create or replace function are_linked(left_id uuid, right_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select left_id = auth.uid()
    and exists (
      select 1
      from users u
      where u.id = left_id
        and u.partner_id = right_id
    );
$$;

create or replace function touch_streaks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := current_date;
begin
  insert into streaks (user_id, partner_id, connection_streak, pulse_streak, last_connected_on, last_pulse_on)
  values (new.sender_id, new.receiver_id, 1, 1, today, today)
  on conflict (user_id, partner_id)
  do update set
    connection_streak = case
      when streaks.last_connected_on = today then streaks.connection_streak
      when streaks.last_connected_on = today - 1 then streaks.connection_streak + 1
      else 1
    end,
    pulse_streak = case
      when streaks.last_pulse_on = today then streaks.pulse_streak
      when streaks.last_pulse_on = today - 1 then streaks.pulse_streak + 1
      else 1
    end,
    last_connected_on = today,
    last_pulse_on = today,
    milestone_count = case
      when (streaks.connection_streak + 1) in (7, 14, 30, 60, 100) then streaks.milestone_count + 1
      else streaks.milestone_count
    end,
    updated_at = now();

  insert into streaks (user_id, partner_id, connection_streak, pulse_streak, last_connected_on, last_pulse_on)
  values (new.receiver_id, new.sender_id, 1, 1, today, today)
  on conflict (user_id, partner_id)
  do update set
    connection_streak = excluded.connection_streak,
    pulse_streak = excluded.pulse_streak,
    last_connected_on = today,
    last_pulse_on = today,
    updated_at = now();

  return new;
end;
$$;

create trigger pulses_touch_streaks
after insert on pulses
for each row execute function touch_streaks();

create or replace function generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code_value text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if exists (select 1 from users where id = auth.uid() and partner_id is not null) then
    raise exception 'Already linked';
  end if;

  loop
    code_value := upper(substr(replace(encode(gen_random_bytes(6), 'base64'), '/', 'P'), 1, 8));
    begin
      insert into invite_codes (owner_id, code, expires_at)
      values (auth.uid(), code_value, now() + interval '24 hours');
      return code_value;
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

create or replace function redeem_invite_code(input_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  normalized text := upper(trim(coalesce(input_code, '')));
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  select owner_id into owner
  from invite_codes
  where code = normalized
    and used_at is null
    and expires_at > now()
  for update;

  if owner is null then
    raise exception 'Invite expired or not found';
  end if;
  if owner = auth.uid() then
    raise exception 'Cannot redeem your own invite';
  end if;
  if exists (select 1 from users where id in (owner, auth.uid()) and partner_id is not null) then
    raise exception 'One of you is already linked';
  end if;

  update users set partner_id = owner, updated_at = now() where id = auth.uid();
  update users set partner_id = auth.uid(), updated_at = now() where id = owner;
  insert into partnerships (user_a, user_b) values (owner, auth.uid());
  update invite_codes set used_by = auth.uid(), used_at = now() where code = normalized;

  return owner;
end;
$$;

alter table users enable row level security;
alter table partnerships enable row level security;
alter table invite_codes enable row level security;
alter table pulses enable row level security;
alter table messages enable row level security;
alter table message_reactions enable row level security;
alter table moods enable row level security;
alter table streaks enable row level security;
alter table notifications enable row level security;

create policy "users can read self and partner" on users
for select to authenticated using (id = auth.uid() or id = (select partner_id from users where id = auth.uid()));
create policy "users can insert self" on users
for insert to authenticated with check (id = auth.uid());
create policy "users can update self" on users
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "partners can read partnership" on partnerships
for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

create policy "invite owner can manage" on invite_codes
for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "pulses are private to pair" on pulses
for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid());
create policy "send pulse to linked partner" on pulses
for insert to authenticated with check (are_linked(sender_id, receiver_id));
create policy "receiver can mark pulse seen" on pulses
for update to authenticated using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());

create policy "messages are private to pair" on messages
for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid());
create policy "send message to linked partner" on messages
for insert to authenticated with check (are_linked(sender_id, receiver_id));
create policy "receiver can mark read" on messages
for update to authenticated using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());

create policy "message reactions visible to pair" on message_reactions
for select to authenticated using (
  exists (select 1 from messages m where m.id = message_id and (m.sender_id = auth.uid() or m.receiver_id = auth.uid()))
);
create policy "message reactions by pair" on message_reactions
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from messages m where m.id = message_id and (m.sender_id = auth.uid() or m.receiver_id = auth.uid()))
);

create policy "moods visible to pair" on moods
for select to authenticated using (user_id = auth.uid() or is_partner(user_id));
create policy "users upsert own mood" on moods
for insert to authenticated with check (user_id = auth.uid());
create policy "users update own mood" on moods
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "streaks visible to owner" on streaks
for select to authenticated using (user_id = auth.uid());

create policy "notifications visible to receiver" on notifications
for select to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table pulses;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table moods;
