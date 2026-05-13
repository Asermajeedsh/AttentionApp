CREATE OR REPLACE FUNCTION can_notify_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      target_user_id = auth.uid()
      OR target_user_id = get_partner_id(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM partner_requests pr
        WHERE pr.status IN ('pending', 'accepted')
          AND (
            (pr.requester_id = auth.uid() AND pr.recipient_user_id = target_user_id)
            OR (pr.requester_id = target_user_id AND pr.recipient_user_id = auth.uid())
          )
      )
    );
$$;

ALTER FUNCTION can_notify_user(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_notify_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_push_subscriptions_for_notification(target_user_id uuid)
RETURNS TABLE(id uuid, subscription jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ps.id, ps.subscription
  FROM push_subscriptions ps
  WHERE ps.user_id = target_user_id
    AND can_notify_user(target_user_id)
  ORDER BY ps.last_seen_at DESC;
$$;

ALTER FUNCTION get_push_subscriptions_for_notification(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION get_push_subscriptions_for_notification(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION get_notification_preferences_for_notification(target_user_id uuid)
RETURNS notification_preferences
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT np.*
  FROM notification_preferences np
  WHERE np.user_id = target_user_id
    AND can_notify_user(target_user_id)
  LIMIT 1;
$$;

ALTER FUNCTION get_notification_preferences_for_notification(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION get_notification_preferences_for_notification(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION touch_push_subscription_for_notification(target_user_id uuid, subscription_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE push_subscriptions
  SET last_seen_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = subscription_id
    AND user_id = target_user_id
    AND can_notify_user(target_user_id);
$$;

ALTER FUNCTION touch_push_subscription_for_notification(uuid, uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION touch_push_subscription_for_notification(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION delete_push_subscription_for_notification(target_user_id uuid, subscription_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM push_subscriptions
  WHERE id = subscription_id
    AND user_id = target_user_id
    AND can_notify_user(target_user_id);
$$;

ALTER FUNCTION delete_push_subscription_for_notification(uuid, uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION delete_push_subscription_for_notification(uuid, uuid) TO authenticated;
