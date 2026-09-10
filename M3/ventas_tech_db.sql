/* =========================================
VENTAS_TECH_DB
CHECKPOINT - INGENIERÍA DE DATOS
========================================= */
 
/* =========================================
CREACIÓN DE BASE DE DATOS
========================================= */
 
CREATE DATABASE Ventas_Tech_DB;
 
/* =========================================
ELIMINAR TABLAS SI EXISTEN
(Orden inverso de dependencias)
========================================= */
 
DROP TABLE IF EXISTS ventas;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS categorias;
 
/* =========================================
CREAR TABLA CATEGORIAS
========================================= */
 
CREATE TABLE categorias (
id_categoria INT PRIMARY KEY,
nombre_categoria VARCHAR(50) NOT NULL,
descripcion VARCHAR(200)
);
 
/* =========================================
CREAR TABLA CLIENTES
========================================= */
 
CREATE TABLE clientes (
id_cliente INT PRIMARY KEY,
nombre VARCHAR(100) NOT NULL,
email VARCHAR(100) UNIQUE,
ciudad VARCHAR(50),
fecha_registro DATE NOT NULL
);
 
/* =========================================
CREAR TABLA PRODUCTOS
========================================= */
 
CREATE TABLE productos (
id_producto INT PRIMARY KEY,
nombre_producto VARCHAR(100) NOT NULL,
id_categoria INT,
precio DECIMAL(10,2) NOT NULL,
stock INT DEFAULT 0,
activo BOOLEAN DEFAULT TRUE,
 
CONSTRAINT fk_producto_categoria
FOREIGN KEY (id_categoria)
REFERENCES categorias(id_categoria)
);
 
/* =========================================
CREAR TABLA VENTAS
========================================= */
 
CREATE TABLE ventas (
id_venta INT PRIMARY KEY,
id_cliente INT,
id_producto INT,
cantidad INT NOT NULL,
precio_unitario DECIMAL(10,2) NOT NULL,
fecha_venta DATE NOT NULL,
 
CONSTRAINT fk_venta_cliente
FOREIGN KEY (id_cliente)
REFERENCES clientes(id_cliente),
 
CONSTRAINT fk_venta_producto
FOREIGN KEY (id_producto)
REFERENCES productos(id_producto)
);
 
/* =========================================
INSERT CATEGORIAS
========================================= */
 
INSERT INTO categorias VALUES
(1, 'Computación', 'Laptops, PCs y monitores'),
(2, 'Accesorios', 'Periféricos y complementos'),
(3, 'Audio', 'Auriculares y parlantes'),
(4, 'Almacenamiento', 'Discos y memorias');
 
/* =========================================
INSERT CLIENTES
========================================= */
 
INSERT INTO clientes VALUES
(1, 'María López', 'maria@mail.com', 'Buenos Aires', '2024-01-05'),
(2, 'Carlos Ruiz', 'carlos@mail.com', 'Córdoba', '2024-01-10'),
(3, 'Ana Gómez', 'ana@mail.com', 'Rosario', '2024-02-01'),
(4, 'Pedro Sanz', 'pedro@mail.com', 'Mendoza', '2024-02-15'),
(5, 'Laura Torres', 'laura@mail.com', 'Tucumán', '2024-03-01');
 
/* =========================================
INSERT PRODUCTOS
========================================= */
 
INSERT INTO productos VALUES
(1, 'Laptop Pro 15', 1, 1200.00, 15, TRUE),
(2, 'Mouse Inalámbrico', 2, 28.00, 80, TRUE),
(3, 'Monitor 4K 27"', 1, 450.00, 12, TRUE),
(4, 'Auriculares BT Pro', 3, 120.00, 35, TRUE),
(5, 'SSD Externo 1TB', 4, 130.00, 18, TRUE),
(6, 'Teclado Mecánico', 2, 95.00, 40, TRUE);
 
/* =========================================
INSERT VENTAS
========================================= */
 
INSERT INTO ventas VALUES
(1, 1, 1, 2, 1200.00, '2024-03-05'),
(2, 2, 2, 5, 28.00, '2024-03-06'),
(3, 3, 3, 1, 450.00, '2024-03-07'),
(4, 1, 4, 2, 120.00, '2024-03-08'),
(5, 4, 5, 3, 130.00, '2024-03-10'),
(6, 2, 6, 4, 95.00, '2024-03-11'),
(7, 5, 1, 1, 1200.00, '2024-03-12'),
(8, 3, 2, 8, 28.00, '2024-03-13'),
(9, 4, 4, 1, 120.00, '2024-03-14'),
(10, 5, 3, 2, 450.00, '2024-03-15');
 
/* =========================================
CONSULTAS DE VALIDACIÓN
========================================= */
 
SELECT * FROM categorias;
SELECT * FROM clientes;
SELECT * FROM productos;
SELECT * FROM ventas;
