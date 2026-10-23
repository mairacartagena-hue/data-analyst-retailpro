do $$
declare
  v_email1 text := 'nicki@ejemplo.com';
  v_email2 text := 'ari@ejemplo.com';
  v_user1 uuid;
  v_user2 uuid;
  v_hh   uuid := 'a0000000-0000-4000-8000-000000000001';
  v_m1   uuid := 'a0000000-0000-4000-8000-000000000011';
  v_m2   uuid := 'a0000000-0000-4000-8000-000000000012';
  v_michi uuid := 'a0000000-0000-4000-8000-000000000021';
  v_mercado uuid := 'a0000000-0000-4000-8000-000000000031';
  v_drogueria uuid := 'a0000000-0000-4000-8000-000000000032';
  v_casa uuid := 'a0000000-0000-4000-8000-000000000033';
  v_hoy date := public.hoy_bogota();
begin
  v_user1 := coalesce(v_user1, (select id from auth.users where lower(email) = lower(v_email1)));
  v_user2 := coalesce(v_user2, (select id from auth.users where lower(email) = lower(v_email2)));
  if v_user1 is null or v_user2 is null then
    raise exception 'No encontré los usuarios de prueba. Créalos primero en Authentication > Users.';
  end if;
  delete from public.households where id = v_hh;
  delete from public.members where user_id in (v_user1, v_user2);
  insert into public.households (id, nombre, codigo_invitacion)
  values (v_hh, 'Casa de Nicki y Ari', 'MICHI234');
  insert into public.members (id, household_id, user_id, nombre, color, created_at) values
    (v_m1, v_hh, v_user1, 'Nicki', 'rosa',  now() - interval '1 minute'),
    (v_m2, v_hh, v_user2, 'Ari',   'bordo', now());
  insert into public.shopping_lists (id, household_id, nombre, quien_va, fecha) values
    (v_mercado,   v_hh, 'Mercado',      v_m2, v_hoy + 2),
    (v_drogueria, v_hh, 'Droguería',    v_m1, null),
    (v_casa,      v_hh, 'Para la casa', null, null);
  insert into public.pets (id, household_id, nombre, especie)
  values (v_michi, v_hh, 'Michi', 'gato');
  insert into public.tasks
    (household_id, titulo, frecuencia, dias_semana, modo, responsable_fijo, orden_rotacion, fecha_inicio, hora_recordatorio, pet_id)
  values
    (v_hh, 'Lavar la loza',       'diaria',    '{}',      'rota',   null,  array[v_m1, v_m2], v_hoy - 7, '20:30', null),
    (v_hh, 'Sacar la basura',     'semanal',   '{1,3,5}', 'fija',   v_m2,  '{}',              v_hoy - 7, '19:00', null),
    (v_hh, 'Planchar',            'semanal',   '{2}',     'fija',   v_m1,  '{}',              v_hoy - 7, null,    null),
    (v_hh, 'Cocinar',             'semanal',   '{2,4}',   'fija',   v_m1,  '{}',              v_hoy - 7, null,    null),
    (v_hh, 'Barrer y trapear',    'semanal',   '{2,6}',   'fija',   v_m1,  '{}',              v_hoy - 7, null,    null),
    (v_hh, 'Hacer mercado',       'semanal',   '{6}',     'juntos', null,  '{}',              v_hoy - 7, '10:00', null),
    (v_hh, 'Limpiar el baño',     'quincenal', '{}',      'rota',   null,  array[v_m2, v_m1], v_hoy - 3, null,    null),
    (v_hh, 'Pagar servicios',     'mensual',   '{}',      'fija',   v_m2,  '{}',              v_hoy - 10, '09:00', null),
    (v_hh, 'Cambiar la arena',    'semanal',   '{1,4}',   'rota',   null,  array[v_m1, v_m2], v_hoy - 7, null,    v_michi);
  insert into public.tasks
    (household_id, titulo, tipo, pet_id, dosis, frecuencia, modo, orden_rotacion,
     fecha_inicio, duracion_dias, horas_toma)
  values
    (v_hh, 'Amoxicilina', 'medicamento', v_michi, '5 ml', 'diaria', 'rota', array[v_m1, v_m2],
     v_hoy - 2, 7, array['08:00', '14:00', '20:00']::time[]);
  insert into public.task_occurrences (task_id, household_id, fecha, hora, responsable_id, completada, completada_por, completada_en)
  select t.id, v_hh, d.f, h.h,
         case when (d.f - t.fecha_inicio) % 2 = 0 then v_m1 else v_m2 end,
         true,
         case when (d.f - t.fecha_inicio) % 2 = 0 then v_m1 else v_m2 end,
         ((d.f + h.h) at time zone 'America/Bogota') + interval '5 minutes'
  from public.tasks t
  cross join (values (v_hoy - 2), (v_hoy - 1)) d(f)
  cross join unnest(t.horas_toma) h(h)
  where t.household_id = v_hh and t.tipo = 'medicamento'
  on conflict do nothing;
  insert into public.pantry_products (household_id, nombre, categoria, duracion_dias, fecha_ultima_compra) values
    (v_hh, 'Café',          'Abarrotes', 30, v_hoy - 26),
    (v_hh, 'Arroz',         'Abarrotes', 20, v_hoy - 5),
    (v_hh, 'Detergente',    'Aseo',      30, v_hoy - 25),
    (v_hh, 'Arena para gato','Otros',    15, v_hoy - 4);
  insert into public.shopping_items (list_id, household_id, nombre, categoria, cantidad, pedido_por) values
    (v_mercado,   v_hh, 'Bananos',        'Frutas y verduras', '6',      v_m1),
    (v_mercado,   v_hh, 'Pechuga',        'Carnes',            '1 kg',   v_m2),
    (v_mercado,   v_hh, 'Leche',          'Lácteos',           '2',      v_m1),
    (v_mercado,   v_hh, 'Arepas',         'Abarrotes',         '1 paq.', v_m2),
    (v_drogueria, v_hh, 'Acetaminofén',   'Otros',             '1 caja', v_m2),
    (v_casa,      v_hh, 'Bombillo LED',   'Otros',             '2',      v_m1);
  insert into public.reminders (household_id, titulo, fecha_hora, responsables, repeticion, aviso_previo_dias, nota) values
    (v_hh, 'Pagar el arriendo',
       ((date_trunc('month', v_hoy) + interval '1 month')::date + time '09:00') at time zone 'America/Bogota',
       array[v_m2], 'mensual', 2, 'Transferencia a don Jorge'),
    (v_hh, 'Cumpleaños de mamá de Ari',
       ((v_hoy + 12) + time '08:00') at time zone 'America/Bogota',
       '{}', 'anual', 5, 'Comprar torta'),
    (v_hh, 'Revisión técnico-mecánica',
       ((v_hoy + 20) + time '10:00') at time zone 'America/Bogota',
       array[v_m1], 'ninguna', 3, null);
  insert into public.pet_events (pet_id, household_id, tipo, titulo, fecha, repeticion, aviso_previo_dias, responsable_id, nota) values
    (v_michi, v_hh, 'vacuna',  'Triple felina',      v_hoy + 30, 'anual',   7, v_m1, 'Veterinaria El Gato Feliz'),
    (v_michi, v_hh, 'control', 'Control de la piel', v_hoy + 6,  'ninguna', 1, null, 'Llevar el carné');
  insert into public.notes (household_id, titulo, contenido) values
    (v_hh, 'Wifi', 'Red: CasaNickiAri' || chr(10) || 'Clave: michi-2026'),
    (v_hh, 'Medidas de la sala', 'Ventana: 1,80 x 1,20 m' || chr(10) || 'Pared del sofá: 3,40 m'),
    (v_hh, 'Teléfonos', 'Veterinaria: 300 123 4567' || chr(10) || 'Administración: 601 765 4321');
end $$;
