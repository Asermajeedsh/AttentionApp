CREATE TABLE IF NOT EXISTS notification_preferences (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'Users can read own notification preferences'
  ) THEN
    CREATE POLICY "Users can read own notification preferences"
    ON notification_preferences
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'Users can upsert own notification preferences'
  ) THEN
    CREATE POLICY "Users can upsert own notification preferences"
    ON notification_preferences
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_preferences'
      AND policyname = 'Users can update own notification preferences'
  ) THEN
    CREATE POLICY "Users can update own notification preferences"
    ON notification_preferences
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

