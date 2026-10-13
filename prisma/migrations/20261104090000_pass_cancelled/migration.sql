-- El centro puede quitar un bono asignado (por error o dado de baja). No se borra la fila: el libro de
-- movimientos conserva el rastro; el bono deja de salir en las listas y de poder usarse.
ALTER TYPE "pass_status" ADD VALUE 'cancelled';
