-- Una invitación se revoca (revoked_at), nunca se borra: queda como rastro de quién invitó a quién.
REVOKE DELETE ON "invitations" FROM yoclick_app;
