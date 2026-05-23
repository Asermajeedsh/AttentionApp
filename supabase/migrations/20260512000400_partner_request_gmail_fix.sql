CREATE OR REPLACE FUNCTION public.create_partner_request(input_email text)
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
  recipient_partner uuid;
  existing_id uuid;
  request_id uuid;
  my_email text;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  my_email := public.auth_email();
  normalized := lower(trim(coalesce(input_email, '')));
  IF position('@' in normalized) = 0 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;

  IF my_email IS NOT NULL AND normalized = my_email THEN
    RAISE EXCEPTION 'You cannot invite yourself';
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
  WHERE lower(email) = normalized
  LIMIT 1;

  IF recipient_id IS NOT NULL AND recipient_id = current_user_id THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;

  IF recipient_id IS NOT NULL THEN
    SELECT partner_id INTO recipient_partner
    FROM public.users
    WHERE id = recipient_id
    LIMIT 1;

    IF recipient_partner IS NOT NULL THEN
      RAISE EXCEPTION 'That user is already linked';
    END IF;
  END IF;

  UPDATE public.partner_requests
  SET status = 'expired',
      responded_at = timezone('utc'::text, now())
  WHERE status = 'pending'
    AND expires_at <= timezone('utc'::text, now())
    AND requester_id = current_user_id
    AND lower(trim(recipient_email)) = normalized;

  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY requester_id, lower(trim(recipient_email))
             ORDER BY created_at DESC
           ) AS rn
    FROM public.partner_requests
    WHERE status = 'pending'
  )
  UPDATE public.partner_requests pr
  SET status = 'cancelled',
      responded_at = timezone('utc'::text, now())
  FROM ranked r
  WHERE pr.id = r.id
    AND r.rn > 1;

  UPDATE public.partner_requests
  SET recipient_email = lower(trim(recipient_email))
  WHERE recipient_email IS NOT NULL
    AND recipient_email <> lower(trim(recipient_email));

  SELECT pr.id INTO existing_id
  FROM public.partner_requests pr
  WHERE pr.status = 'pending'
    AND pr.expires_at > timezone('utc'::text, now())
    AND pr.requester_id = current_user_id
    AND pr.recipient_email = normalized
  ORDER BY pr.created_at DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  BEGIN
    INSERT INTO public.partner_requests (
      requester_id,
      recipient_email,
      recipient_user_id,
      status,
      expires_at
    )
    VALUES (
      current_user_id,
      normalized,
      recipient_id,
      'pending',
      timezone('utc'::text, now()) + interval '7 days'
    )
    RETURNING id INTO request_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT pr.id INTO request_id
    FROM public.partner_requests pr
    WHERE pr.status = 'pending'
      AND pr.expires_at > timezone('utc'::text, now())
      AND pr.requester_id = current_user_id
      AND pr.recipient_email = normalized
    ORDER BY pr.created_at DESC
    LIMIT 1;
  END;

  RETURN request_id;
END;
$$;

ALTER FUNCTION public.create_partner_request(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.create_partner_request(text) TO authenticated;
