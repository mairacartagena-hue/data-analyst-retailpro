-- Limpieza única (25-oct-2026): borra 4 copias del crédito hipotecario de octubre.
-- No es una migración: se pega una sola vez en Supabase → SQL Editor, después de la migración 0025.
--
-- Pagos REALES que se conservan:
--   7353a082…  $2.000       1-oct   (pago de prueba)
--   76ea3837…  $1.950.980   5-oct   (la cuota)
--   9147c632…  $1.953.000   23-oct  (otro pago, otro monto y otro número de transacción)
--
-- Copias que se borran (los mismos pagos que se leyeron otra vez desde los correos de AvalPay, sin fecha):
--   9de0a510…  $1.950.980  pendiente           → copia de 76ea3837…
--   d5f31db2…  $1.950.980  confirmada (24-oct) → copia de 76ea3837…
--   3d3be656…  $1.950.980  confirmada (25-oct) → copia de 76ea3837… (con letras raras en el nombre)
--   529fe452…  $2.000      pendiente           → copia de 7353a082…
-- Cada borrado exige además el monto y que sea un gasto de Banco de Bogotá, así que si algo no coincide no borra nada.
-- Los avisos (ingest_logs) que apuntaban a las copias pasan a apuntar al pago original.

begin;

update ingest_logs set transaction_id = '76ea3837-5286-4cbf-9234-02a923c01706'
 where transaction_id in ('9de0a510-f3b2-4b7c-b579-7cb62f0eb4e1', 'd5f31db2-7d99-40a8-b8c4-0af529bb3374', '3d3be656-ed98-4e80-a481-760d3fecc0b3')
   and exists (select 1 from transactions where id = '76ea3837-5286-4cbf-9234-02a923c01706');

update ingest_logs set transaction_id = '7353a082-35a9-4fb6-ac78-c726fada521b'
 where transaction_id = '529fe452-c266-402a-8c30-cf56695f9b9e'
   and exists (select 1 from transactions where id = '7353a082-35a9-4fb6-ac78-c726fada521b');

delete from transactions
 where kind = 'EXPENSE' and merchant ilike '%bogot%'
   and ((id = '9de0a510-f3b2-4b7c-b579-7cb62f0eb4e1' and amount = 1950980)
     or (id = 'd5f31db2-7d99-40a8-b8c4-0af529bb3374' and amount = 1950980)
     or (id = '3d3be656-ed98-4e80-a481-760d3fecc0b3' and amount = 1950980)
     or (id = '529fe452-c266-402a-8c30-cf56695f9b9e' and amount = 2000));

-- Debe quedar: 3 pagos reales y 0 copias
select id, amount, status, occurred_on, left(merchant, 40) as comercio
  from transactions
 where kind = 'EXPENSE' and merchant ilike '%bogot%' and occurred_on between '2026-10-01' and '2026-10-31'
 order by occurred_on, amount;

commit;
