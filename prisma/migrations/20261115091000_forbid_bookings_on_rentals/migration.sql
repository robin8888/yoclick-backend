-- Un alquiler (sesión sin profesor) no se reserva: se cede la sala, no hay cita con nadie.
CREATE OR REPLACE FUNCTION forbid_booking_on_session_without_staff() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM class_sessions WHERE id = NEW.class_session_id AND staff_membership_id IS NULL
  ) THEN
    RAISE EXCEPTION 'session_without_staff_cannot_be_booked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_forbid_session_without_staff
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION forbid_booking_on_session_without_staff();
