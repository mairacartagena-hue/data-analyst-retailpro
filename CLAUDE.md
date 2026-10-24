# Instrucciones para Claude

- Migraciones SQL: Claude las corre en Supabase (proyecto finanzas-pareja) con el conector cuando puede.
  Si el conector pide una autorización que no llega (o no se puede correr), enviarle a la persona
  el enlace de GitHub del archivo para que lo pegue en Supabase → SQL Editor.
- Cuando la persona pida el SQL de una migración, dar siempre el enlace de GitHub del archivo
  (ej. https://github.com/mairacartagena-hue/data-analyst-retailpro/blob/<rama>/finanzas/supabase/migrations/<archivo>.sql),
  con la rama donde está subido, para copiarlo desde ahí y pegarlo en Supabase → SQL Editor.
- Cuando se abra un pull request, Claude también hace el merge (no se lo deja a la persona),
  después de verificar que las revisiones y el despliegue de vista previa de Vercel pasan,
  y que las migraciones SQL que necesite ya estén aplicadas en Supabase.
