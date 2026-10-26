-- Limpieza única (26-oct-2026): borra todos los movimientos con fecha ANTERIOR al 15 de octubre de 2026
-- (el 15 de octubre se conserva). Del 24-sep al 12-oct eran 66 movimientos del hogar.
-- No es una migración: se pega una sola vez en Supabase → SQL Editor.
--
--  · Se borran también sus etiquetas, comentarios y partes (en cascada). No hay filas del cruce de deudas en ese rango.
--  · Los avisos guardados (ingest_logs) se quedan, sin movimiento asociado: así un correo viejo no se vuelve a
--    registrar si se reenvía.
--  · Los saldos de las cuentas se recalculan solos (saldo inicial + los movimientos que queden).
--  · No se puede deshacer. Si no estás segura, haz antes una copia en Supabase → Database → Backups.

begin;

-- Seguro: si el rango trae muchos más de lo esperado, se detiene sin borrar nada
do $$
declare v_n int;
begin
  select count(*) into v_n from transactions where occurred_on < '2026-10-15';
  if v_n > 90 then
    raise exception 'Iba a borrar % movimientos (se esperaban unos 66). No se borró nada.', v_n;
  end if;
end
$$;

delete from transactions where occurred_on < '2026-10-15';

-- Debe quedar 0 antes del 15 de octubre y 54 desde el 15 (el 15 más los 51 posteriores; puede variar si llegaron avisos nuevos)
select
  (select count(*) from transactions where occurred_on < '2026-10-15') as antes_del_15,
  (select count(*) from transactions where occurred_on >= '2026-10-15') as desde_el_15,
  (select min(occurred_on) from transactions) as primera_fecha;

commit;
