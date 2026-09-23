/* =========================================
M5 - CONSULTAS CON JOINS
RETAILPRO / VENTAS_TECH_DB
========================================= */
 
 
/* =========================================
CONSULTA 1
VISTA BASE DEL PROYECTO
INNER JOIN
========================================= */
 
SELECT
v.fecha_venta,
c.id_cliente,
c.nombre AS nombre_cliente,
c.email,
c.ciudad,
p.id_producto,
p.nombre_producto,
cat.nombre_categoria,
v.cantidad,
v.precio_unitario,
(v.cantidad * v.precio_unitario) AS total_venta
FROM ventas v
INNER JOIN clientes c
ON v.id_cliente = c.id_cliente
INNER JOIN productos p
ON v.id_producto = p.id_producto
INNER JOIN categorias cat
ON p.id_categoria = cat.id_categoria;
 
 
/* =========================================
CONSULTA 2
CLIENTES SIN VENTAS
LEFT JOIN
========================================= */
 
SELECT
c.nombre,
c.email,
c.fecha_registro
FROM clientes c
LEFT JOIN ventas v
ON c.id_cliente = v.id_cliente
WHERE v.id_cliente IS NULL;
 
 
/* =========================================
CONSULTA 3
PRODUCTOS SIN VENTAS
LEFT JOIN
========================================= */
 
SELECT
p.nombre_producto,
cat.nombre_categoria,
p.precio
FROM productos p
LEFT JOIN ventas v
ON p.id_producto = v.id_producto
INNER JOIN categorias cat
ON p.id_categoria = cat.id_categoria
WHERE v.id_producto IS NULL;
 
 
/* =========================================
CONSULTA 4
CONSOLIDADO POR CANAL
UNION ALL
========================================= */
 
SELECT
canal,
SUM(total_venta) AS total_facturado
FROM
(
SELECT
fecha_venta,
(cantidad * precio_unitario) AS total_venta,
'Online' AS canal
FROM ventas
WHERE id_cliente <= 3
 
UNION ALL
 
SELECT
fecha_venta,
(cantidad * precio_unitario) AS total_venta,
'Presencial' AS canal
FROM ventas
WHERE id_cliente > 3
 
) consolidado
GROUP BY canal
ORDER BY total_facturado DESC;
 
 
/* =========================================
HALLAZGOS
========================================= */
 
-- Hallazgo 1:
-- La vista consolidada permite analizar las ventas por
-- cliente, producto y categoría en una sola consulta,
-- facilitando la futura conexión con Power BI.
 
-- Hallazgo 2:
-- Los clientes sin registros en la tabla ventas pueden
-- convertirse en oportunidades para campañas comerciales.
 
-- Hallazgo 3:
-- Los productos sin ventas permiten identificar artículos
-- con baja rotación o potencial necesidad de promoción.
