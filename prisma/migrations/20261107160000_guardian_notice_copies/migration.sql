-- Los avisos de un menor llegan también a su tutor: al crear un aviso para alguien que tiene tutores
-- se crea una copia para cada uno, marcada con el nombre del menor. Al hacerse en la base de datos
-- vale para cualquier aviso (citas, bonos, clases canceladas…) y el envío al móvil no cambia.
CREATE FUNCTION notify_guardians_of_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- La copia lleva `forChildName`: no se vuelve a copiar.
  IF NEW.data ? 'forChildName' THEN
    RETURN NEW;
  END IF;
  INSERT INTO notifications (id, center_id, recipient_membership_id, kind, data, booking_id, created_at)
  SELECT gen_random_uuid(), NEW.center_id, g.guardian_membership_id, NEW.kind,
         NEW.data || jsonb_build_object('forChildName', u.full_name), NEW.booking_id, NEW.created_at
  FROM guardian_links g
  JOIN memberships m ON m.id = g.child_membership_id
  JOIN users u ON u.id = m.user_id
  WHERE g.child_membership_id = NEW.recipient_membership_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER notifications_copy_to_guardians
AFTER INSERT ON "notifications"
FOR EACH ROW EXECUTE FUNCTION notify_guardians_of_child();
