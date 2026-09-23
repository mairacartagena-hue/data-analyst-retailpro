/* =========================================
M4 - CONSULTAS DE NEGOCIO
RETAILPRO / VENTAS_TECH_DB
========================================= */
 
 
/* =========================================
CONSULTA 1
RESUMEN EJECUTIVO MENSUAL
========================================= */
 
SELECT
EXTRACT(MONTH FROM fecha_venta) AS mes,
SUM(cantidad * precio_unitario) AS total_facturado,
COUNT(*) AS cantidad_pedidos,
ROUND(
SUM(cantidad * precio_unitario) / COUNT(*),
2
) AS ticket_promedio
FROM ventas
GROUP BY EXTRACT(MONTH FROM fecha_venta)
ORDER BY mes;
 
 
/* =========================================
CONSULTA 2
TOP 5 PRODUCTOS POR FACTURACIÓN
========================================= */
 
SELECT
id_producto,
SUM(cantidad) AS unidades_vendidas,
SUM(cantidad * precio_unitario) AS total_facturado
FROM ventas
GROUP BY id_producto
ORDER BY total_facturado DESC
LIMIT 5;
 
 
/* =========================================
CONSULTA 3
CLIENTES RECURRENTES
========================================= */
 
SELECT
id_cliente,
COUNT(*) AS cantidad_pedidos,
SUM(cantidad * precio_unitario) AS total_gastado
FROM ventas
GROUP BY id_cliente
HAVING COUNT(*) > 1
ORDER BY total_gastado DESC;
 
 
/* =========================================
CONSULTA 4
MESES POR ENCIMA / DEBAJO DEL PROMEDIO
========================================= */
 
WITH ventas_mensuales AS (
 
SELECT
EXTRACT(MONTH FROM fecha_venta) AS mes,
SUM(cantidad * precio_unitario) AS total_facturado
FROM ventas
GROUP BY EXTRACT(MONTH FROM fecha_venta)
 
)
 
SELECT
mes,
total_facturado,
 
CASE
WHEN total_facturado >
(
SELECT AVG(total_facturado)
FROM ventas_mensuales
)
THEN 'Por encima'
 
ELSE 'Por debajo'
 
END AS comparacion_promedio
 
FROM ventas_mensuales
ORDER BY mes;
 
 
/* =========================================
HALLAZGOS DE NEGOCIO
========================================= */
 
-- Hallazgo 1:
-- Los productos de mayor precio generan la mayor parte
-- de la facturación total aun cuando la cantidad vendida
-- sea menor que otros productos.
 
-- Hallazgo 2:
-- Existen clientes recurrentes que realizaron más de una
-- compra, representando una oportunidad para campañas
-- de fidelización.
 
-- Hallazgo 3:
-- El análisis mensual permite identificar períodos con
-- facturación superior e inferior al promedio general,
-- facilitando el seguimiento del desempeño comercial.
