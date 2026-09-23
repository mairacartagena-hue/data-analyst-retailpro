-- =====================================================
-- Archivo: modulo2_unidad1_diseno.sql
-- Descripción: Diseño de tablas para un sistema de ventas
-- =====================================================
 
-- Tabla de clientes
CREATE TABLE clientes (
-- INTEGER porque identifica al cliente mediante un número entero
id_cliente INTEGER,
 
-- VARCHAR(100) porque almacena texto de longitud variable
-- hasta un máximo de 100 caracteres
nombre VARCHAR(100),
 
-- TEXT porque permite guardar biografías o notas extensas
perfil_bio TEXT,
 
-- DATE porque solo se necesita almacenar la fecha de registro
fecha_registro DATE
);
 
-- Tabla de productos
CREATE TABLE productos (
-- INTEGER para identificar cada producto con un número entero
id_producto INTEGER,
 
-- VARCHAR(255) para almacenar una descripción de tamaño moderado
descripcion VARCHAR(255),
 
-- DECIMAL(10,2) para manejar valores monetarios con precisión
-- hasta 10 dígitos en total y 2 decimales
precio DECIMAL(10,2),
 
-- BOOLEAN para indicar si el producto está activo o no
-- (TRUE = activo, FALSE = inactivo)
esta_activo BOOLEAN
);
