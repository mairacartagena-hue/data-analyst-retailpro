# Instrucciones para Claude

- Cuando la persona pida el SQL de una migración, dar siempre el enlace de GitHub del archivo
  (ej. https://github.com/mairacartagena-hue/data-analyst-retailpro/blob/<rama>/finanzas/supabase/migrations/<archivo>.sql),
  con la rama donde está subido, para copiarlo desde ahí y pegarlo en Supabase → SQL Editor.
- Cuando se abra un pull request, Claude también hace el merge (no se lo deja a la persona),
  después de verificar que las revisiones y el despliegue de vista previa de Vercel pasan,
  y que las migraciones SQL que necesite ya estén aplicadas en Supabase.
