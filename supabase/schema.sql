-- Drop existing tables if any
DROP TABLE IF EXISTS beeps;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS entries;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create users table
CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  name text,
  role text CHECK (role IN ('me', 'partner')),
  partner_id uuid,
  push_token text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX users_email_lower_unique
ON users (lower(email))
WHERE email IS NOT NULL;

ALTER TABLE users
ADD CONSTRAINT users_partner_id_fkey
FOREIGN KEY (partner_id) REFERENCES users(id) ON DELETE SET NULL;

-- Enable Row Level Security for the users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and partner"
ON users
FOR SELECT
TO authenticated
USING (id = auth.uid() OR id = get_partner_id(auth.uid()));

CREATE POLICY "Users can insert their own profile"
ON users
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Policy: Users can only update their own row
CREATE POLICY "Users can update their own profile"
ON users
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION auth_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(lower(trim((auth.jwt() ->> 'email'))), '')
$$;

ALTER FUNCTION auth_email() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION auth_email() TO authenticated;

CREATE OR REPLACE FUNCTION get_partner_id(target_user uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.partner_id
  FROM public.users u
  WHERE u.id = target_user
  LIMIT 1
$$;

ALTER FUNCTION get_partner_id(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION get_partner_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION auto_link_partner()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  other_user_id uuid;
  current_partner_id uuid;
  other_partner_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT partner_id INTO current_partner_id
  FROM users
  WHERE id = current_user_id
  FOR UPDATE;

  IF current_partner_id IS NOT NULL THEN
    RETURN current_partner_id;
  END IF;

  SELECT u.id, u.partner_id
  INTO other_user_id, other_partner_id
  FROM users u
  WHERE u.id <> current_user_id
  ORDER BY u.created_at ASC
  FOR UPDATE
  LIMIT 1;

  IF other_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF other_partner_id IS NOT NULL AND other_partner_id <> current_user_id THEN
    RETURN NULL;
  END IF;

  UPDATE users
  SET partner_id = other_user_id,
      updated_at = timezone('utc'::text, now())
  WHERE id = current_user_id;

  UPDATE users
  SET partner_id = current_user_id,
      updated_at = timezone('utc'::text, now())
  WHERE id = other_user_id;

  RETURN other_user_id;
END;
$$;

ALTER FUNCTION auto_link_partner() OWNER TO postgres;

GRANT EXECUTE ON FUNCTION auto_link_partner() TO authenticated;

CREATE TABLE invite_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  code text NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  used_by uuid REFERENCES users(id) ON DELETE SET NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX invite_codes_owner_id_idx ON invite_codes(owner_id);

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their invite codes"
ON invite_codes
FOR SELECT
TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY "Owners can create invite codes"
ON invite_codes
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can delete invite codes"
ON invite_codes
FOR DELETE
TO authenticated
USING (owner_id = auth.uid());

CREATE TABLE partner_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  recipient_email text NOT NULL,
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  responded_at timestamp with time zone
);

CREATE INDEX partner_requests_requester_id_idx ON partner_requests(requester_id);
CREATE INDEX partner_requests_recipient_email_idx ON partner_requests(recipient_email);
CREATE INDEX partner_requests_recipient_user_id_idx ON partner_requests(recipient_user_id);
CREATE UNIQUE INDEX partner_requests_unique_pending_idx
ON partner_requests(requester_id, recipient_email)
WHERE status = 'pending';

ALTER TABLE partner_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read partner requests"
ON partner_requests
FOR SELECT
TO authenticated
USING (
  requester_id = auth.uid()
  OR recipient_email = auth_email()
  OR recipient_user_id = auth.uid()
);

CREATE POLICY "Users can create partner requests"
ON partner_requests
FOR INSERT
TO authenticated
WITH CHECK (requester_id = auth.uid());

CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  code_value text;
  tries int := 0;
  my_partner uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT partner_id INTO my_partner
  FROM public.users
  WHERE id = current_user_id
  FOR UPDATE;

  IF my_partner IS NOT NULL THEN
    RAISE EXCEPTION 'Already linked';
  END IF;

  LOOP
    tries := tries + 1;
    IF tries > 10 THEN
      RAISE EXCEPTION 'Failed to generate code';
    END IF;

    code_value := upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 8));
    code_value := translate(code_value, '+/=', 'XYZ');

    BEGIN
      INSERT INTO public.invite_codes (owner_id, code, expires_at)
      VALUES (current_user_id, code_value, timezone('utc'::text, now()) + interval '24 hours');
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RETURN code_value;
END;
$$;

ALTER FUNCTION generate_invite_code() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION generate_invite_code() TO authenticated;

CREATE OR REPLACE FUNCTION redeem_invite_code(input_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  normalized text;
  owner_id uuid;
  owner_partner uuid;
  my_partner uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  normalized := upper(trim(coalesce(input_code, '')));
  IF length(normalized) < 4 THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  SELECT ic.owner_id
    INTO owner_id
    FROM public.invite_codes ic
    WHERE ic.code = normalized
      AND ic.used_at IS NULL
      AND ic.expires_at > timezone('utc'::text, now())
    FOR UPDATE;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Invite code not found or expired';
  END IF;

  IF owner_id = current_user_id THEN
    RAISE EXCEPTION 'Cannot use your own invite code';
  END IF;

  SELECT partner_id INTO my_partner FROM public.users WHERE id = current_user_id FOR UPDATE;
  SELECT partner_id INTO owner_partner FROM public.users WHERE id = owner_id FOR UPDATE;

  IF my_partner IS NOT NULL THEN
    RAISE EXCEPTION 'You are already linked';
  END IF;

  IF owner_partner IS NOT NULL THEN
    RAISE EXCEPTION 'That user is already linked';
  END IF;

  UPDATE public.users
  SET partner_id = owner_id,
      updated_at = timezone('utc'::text, now())
  WHERE id = current_user_id;

  UPDATE public.users
  SET partner_id = current_user_id,
      updated_at = timezone('utc'::text, now())
  WHERE id = owner_id;

  UPDATE public.invite_codes
  SET used_by = current_user_id,
      used_at = timezone('utc'::text, now())
  WHERE code = normalized
    AND used_at IS NULL;

  UPDATE public.partner_requests
  SET status = 'accepted',
      recipient_user_id = current_user_id,
      responded_at = timezone('utc'::text, now())
  WHERE requester_id = owner_id
    AND status = 'pending'
    AND (recipient_user_id = current_user_id OR recipient_email = auth_email());

  RETURN owner_id;
END;
$$;

ALTER FUNCTION redeem_invite_code(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION redeem_invite_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION create_partner_request(input_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  normalized text;
  my_partner uuid;
  recipient_id uuid;
  request_id uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  normalized := lower(trim(coalesce(input_email, '')));
  IF position('@' in normalized) = 0 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;

  SELECT partner_id INTO my_partner
  FROM public.users
  WHERE id = current_user_id
  FOR UPDATE;

  IF my_partner IS NOT NULL THEN
    RAISE EXCEPTION 'Already linked';
  END IF;

  SELECT id INTO recipient_id
  FROM public.users
  WHERE email = normalized
  LIMIT 1;

  INSERT INTO public.partner_requests (requester_id, recipient_email, recipient_user_id, status, expires_at)
  VALUES (current_user_id, normalized, recipient_id, 'pending', timezone('utc'::text, now()) + interval '7 days')
  RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

ALTER FUNCTION create_partner_request(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION create_partner_request(text) TO authenticated;

CREATE OR REPLACE FUNCTION accept_partner_request(request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  requester_id uuid;
  my_partner uuid;
  requester_partner uuid;
  my_email text;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  my_email := auth_email();
  IF my_email IS NULL THEN
    RAISE EXCEPTION 'Missing email';
  END IF;

  SELECT pr.requester_id
    INTO requester_id
    FROM public.partner_requests pr
    WHERE pr.id = request_id
      AND pr.status = 'pending'
      AND pr.expires_at > timezone('utc'::text, now())
      AND (pr.recipient_user_id = current_user_id OR pr.recipient_email = my_email)
    FOR UPDATE;

  IF requester_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found or expired';
  END IF;

  SELECT partner_id INTO my_partner FROM public.users WHERE id = current_user_id FOR UPDATE;
  SELECT partner_id INTO requester_partner FROM public.users WHERE id = requester_id FOR UPDATE;

  IF my_partner IS NOT NULL THEN
    RAISE EXCEPTION 'You are already linked';
  END IF;

  IF requester_partner IS NOT NULL THEN
    RAISE EXCEPTION 'That user is already linked';
  END IF;

  UPDATE public.users
  SET partner_id = requester_id,
      updated_at = timezone('utc'::text, now())
  WHERE id = current_user_id;

  UPDATE public.users
  SET partner_id = current_user_id,
      updated_at = timezone('utc'::text, now())
  WHERE id = requester_id;

  UPDATE public.partner_requests
  SET status = 'accepted',
      recipient_user_id = current_user_id,
      responded_at = timezone('utc'::text, now())
  WHERE id = request_id;

  RETURN requester_id;
END;
$$;

ALTER FUNCTION accept_partner_request(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION accept_partner_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION decline_partner_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  my_email text;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  my_email := auth_email();
  UPDATE public.partner_requests
  SET status = 'declined',
      recipient_user_id = current_user_id,
      responded_at = timezone('utc'::text, now())
  WHERE id = request_id
    AND status = 'pending'
    AND expires_at > timezone('utc'::text, now())
    AND (recipient_user_id = current_user_id OR recipient_email = my_email);
END;
$$;

ALTER FUNCTION decline_partner_request(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION decline_partner_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_partner_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.partner_requests
  SET status = 'cancelled',
      responded_at = timezone('utc'::text, now())
  WHERE id = request_id
    AND requester_id = current_user_id
    AND status = 'pending';
END;
$$;

ALTER FUNCTION cancel_partner_request(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION cancel_partner_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION unlink_partner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  partner uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT partner_id INTO partner
  FROM public.users
  WHERE id = current_user_id
  FOR UPDATE;

  IF partner IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.users
  SET partner_id = NULL,
      updated_at = timezone('utc'::text, now())
  WHERE id IN (current_user_id, partner);
END;
$$;

ALTER FUNCTION unlink_partner() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION unlink_partner() TO authenticated;

-- Create beeps table
CREATE TABLE beeps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  receiver_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security for the beeps table
ALTER TABLE beeps ENABLE ROW LEVEL SECURITY;

-- Policy: INSERT only if sender_id = auth.uid()
CREATE POLICY "Users can insert their own beeps"
ON beeps
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id);

-- Policy: SELECT only if auth.uid() = sender_id OR receiver_id
CREATE POLICY "Users can view their own beeps"
ON beeps
FOR SELECT
TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- NO update or delete allowed (implicit since no policies are added for them)

-- Create game_sessions table
CREATE TABLE game_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player1_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  player2_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  game_state jsonb NOT NULL,
  current_turn text NOT NULL CHECK (current_turn IN ('players', 'ai')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can create their session"
ON game_sessions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = player1_id OR auth.uid() = player2_id);

CREATE POLICY "Players can view their session"
ON game_sessions
FOR SELECT
TO authenticated
USING (auth.uid() = player1_id OR auth.uid() = player2_id);

CREATE POLICY "Players can update their session"
ON game_sessions
FOR UPDATE
TO authenticated
USING (auth.uid() = player1_id OR auth.uid() = player2_id)
WITH CHECK (auth.uid() = player1_id OR auth.uid() = player2_id);

-- Create push_subscriptions table
CREATE TABLE push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  endpoint text NOT NULL,
  subscription jsonb NOT NULL,
  user_agent text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_seen_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can upsert their own subscription"
ON push_subscriptions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscription"
ON push_subscriptions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own and partner subscription"
ON push_subscriptions
FOR SELECT
TO authenticated
USING (
  push_subscriptions.user_id = auth.uid()
  OR push_subscriptions.user_id = get_partner_id(auth.uid())
);

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mute_all boolean NOT NULL DEFAULT false,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_start_minutes integer NOT NULL DEFAULT 1320 CHECK (quiet_start_minutes BETWEEN 0 AND 1439),
  quiet_end_minutes integer NOT NULL DEFAULT 480 CHECK (quiet_end_minutes BETWEEN 0 AND 1439),
  timezone text NOT NULL DEFAULT 'UTC',
  notify_dm boolean NOT NULL DEFAULT true,
  notify_beep boolean NOT NULL DEFAULT true,
  notify_invite boolean NOT NULL DEFAULT true,
  notify_game boolean NOT NULL DEFAULT true,
  notify_call boolean NOT NULL DEFAULT true,
  notify_missed_call boolean NOT NULL DEFAULT true,
  notify_mood boolean NOT NULL DEFAULT true,
  notify_rating boolean NOT NULL DEFAULT true,
  notify_reminder boolean NOT NULL DEFAULT true,
  calls_bypass_quiet_hours boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification preferences"
ON notification_preferences
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can upsert own notification preferences"
ON notification_preferences
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own notification preferences"
ON notification_preferences
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TABLE mood_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  mood text NOT NULL CHECK (mood IN ('happy', 'good', 'overstimulated', 'stressed', 'sad', 'angry', 'tired', 'great', 'okay')),
  note text,
  mood_date date NOT NULL DEFAULT (timezone('utc'::text, now())::date),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, mood_date)
);

ALTER TABLE mood_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own mood"
ON mood_entries
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mood"
ON mood_entries
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own and partner mood"
ON mood_entries
FOR SELECT
TO authenticated
USING (
  mood_entries.user_id = auth.uid()
  OR mood_entries.user_id = get_partner_id(auth.uid())
);

CREATE TABLE partner_ratings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rater_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  rated_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  love smallint NOT NULL CHECK (love BETWEEN 1 AND 5),
  attention smallint NOT NULL CHECK (attention BETWEEN 1 AND 5),
  neglect smallint NOT NULL CHECK (neglect BETWEEN 1 AND 5),
  disrespect smallint NOT NULL CHECK (disrespect BETWEEN 1 AND 5),
  compliments smallint NOT NULL CHECK (compliments BETWEEN 1 AND 5),
  comments text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE partner_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert partner ratings"
ON partner_ratings
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = rater_id
  AND get_partner_id(auth.uid()) = rated_id
);

CREATE POLICY "Users can read ratings involving them"
ON partner_ratings
FOR SELECT
TO authenticated
USING (auth.uid() = rater_id OR auth.uid() = rated_id);

CREATE TABLE waitlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id),
  UNIQUE (email)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join waitlist"
ON waitlist
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (auth.uid() IS NOT NULL AND user_id = auth.uid())
  OR
  (auth.uid() IS NULL AND user_id IS NULL AND email IS NOT NULL)
);

CREATE POLICY "Users can view their waitlist entry"
ON waitlist
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can update their waitlist entry"
ON waitlist
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Enable realtime for beeps table
ALTER PUBLICATION supabase_realtime ADD TABLE beeps;
ALTER PUBLICATION supabase_realtime ADD TABLE users;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  receiver_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  delivered_at timestamp with time zone,
  read_at timestamp with time zone,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their messages"
ON messages
FOR SELECT
TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can send messages"
ON messages
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update message receipts"
ON messages
FOR UPDATE
TO authenticated
USING (auth.uid() = receiver_id OR auth.uid() = sender_id)
WITH CHECK (auth.uid() = receiver_id OR auth.uid() = sender_id);

CREATE TABLE IF NOT EXISTS calls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  caller_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  receiver_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  call_type text CHECK (call_type IN ('audio', 'video')) NOT NULL,
  status text CHECK (status IN ('ringing', 'active', 'declined', 'ended')) NOT NULL DEFAULT 'ringing',
  offer_type text,
  offer_sdp text,
  answer_type text,
  answer_sdp text,
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read calls involving them"
ON calls
FOR SELECT
TO authenticated
USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can start calls"
ON calls
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = caller_id);

CREATE POLICY "Users can update calls involving them"
ON calls
FOR UPDATE
TO authenticated
USING (auth.uid() = caller_id OR auth.uid() = receiver_id)
WITH CHECK (auth.uid() = caller_id OR auth.uid() = receiver_id);

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE calls;
