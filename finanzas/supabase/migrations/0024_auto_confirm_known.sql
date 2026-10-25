-- 0024 · Lo que la app ya reconoce se confirma solo.
--
-- Antes, un comercio guardado en la memoria seguía llegando como "pendiente de confirmar" a menos que la persona
-- hubiera prendido "Aplicar siempre" a mano (nacía apagado). Ahora nace prendido: si el comercio, llave o cuenta ya
-- tiene categoría en la memoria, el aviso entra confirmado con esa categoría. Solo queda para revisar lo que la app
-- no logra identificar. "Aplicar siempre" se puede apagar comercio por comercio en Captura automática.
-- Se puede volver a correr sin problema.

alter table public.merchant_memory alter column auto_apply set default true;
update public.merchant_memory set auto_apply = true where not auto_apply;
