RetailPro - Proyecto de Análisis de Datos para Retail
📊 Descripción del Proyecto

RetailPro es un proyecto integral de análisis de datos desarrollado como parte de un programa de formación en Data Analytics. El objetivo principal es transformar datos transaccionales del sector retail en información estratégica que facilite la toma de decisiones comerciales mediante procesos de extracción, transformación y carga (ETL), análisis en SQL y visualización interactiva en Power BI.

El proyecto cubre el ciclo completo de analítica de datos, desde la preparación y modelado de la información hasta la construcción de indicadores de negocio y dashboards ejecutivos.

🎯 Objetivos del Proyecto

Consolidar y transformar información proveniente de diferentes fuentes de datos.
Diseñar un modelo de datos eficiente para análisis empresarial.
Implementar consultas SQL para la exploración y validación de datos.
Construir métricas de negocio utilizando DAX.
Desarrollar dashboards interactivos en Power BI.
Generar insights que apoyen la gestión comercial y operativa de una empresa retail.
🛠️ Tecnologías Utilizadas
Tecnología	PropósitoSQL	Extracción, limpieza y análisis de datos
Power BI	Visualización y construcción de dashboards
DAX	Creación de métricas e indicadores de negocio
Power Query	Procesos ETL y transformación de datos
Excel / CSV	Fuente de datos y validaciones
Modelo Estrella	Diseño de estructura analítica

📂 Estructura del Proyecto

Plain Text
RetailPro/
│
├── data/
│ ├── raw/
│ │ ├── ventas.csv
│ │ ├── clientes.csv
│ │ └── productos.csv
│ │
│ └── processed/
│ └── datos_limpios.csv
│
├── sql/
│ ├── consultas_exploratorias.sql
│ ├── limpieza_datos.sql
│ └── metricas_negocio.sql
│
├── powerbi/
│ ├── RetailPro.pbix
│ └── imagenes_dashboard/
│
├── docs/
│ ├── diccionario_datos.md
│ └── documentacion_modelo.md
│
└── README.md

🔄 Proceso ETL

El proyecto implementa un proceso ETL orientado a garantizar la calidad y consistencia de la información.

Extracción
Importación de archivos CSV y Excel.
Validación de estructura y tipos de datos.
Identificación de registros incompletos o inconsistentes.
Transformación
Limpieza de datos duplicados.
Estandarización de formatos.
Gestión de valores nulos.
Creación de tablas dimensionales.
Construcción de un modelo estrella.
Carga
Integración de los datos transformados en Power BI.
Creación de relaciones entre tablas.
Optimización del modelo para análisis y visualización.

🗃️ Modelo de Datos

El proyecto utiliza una arquitectura Star Schema (Modelo Estrella) conformada por:

Tabla de Hechos
Fact_Ventas
Tablas Dimensión
Dim_Clientes
Dim_Productos
Dim_Fecha
Dim_Categorías
Dim_Tiendas

Este enfoque permite mejorar el rendimiento de las consultas y facilitar el análisis multidimensional.

📈 Indicadores Clave (KPIs)

Entre los principales indicadores desarrollados se encuentran:

Ventas Totales
Cantidad de Transacciones
Ticket Promedio
Ventas por Categoría
Ventas por Región
Top Productos Vendidos
Crecimiento Mensual
Participación por Segmento de Cliente
Margen de Rentabilidad
Variación Interanual
Ejemplo de Medida DAX
DAX
Ventas Totales =
SUM(Fact_Ventas[Monto_Venta])
DAX
Ticket Promedio =
DIVIDE(
[Ventas Totales],
DISTINCTCOUNT(Fact_Ventas[Id_Transaccion])
)

📊 Dashboard Desarrollado

El dashboard en Power BI incluye:

Resumen Ejecutivo
Ventas totales
Crecimiento mensual
KPIs estratégicos
Análisis Comercial
Ventas por producto
Ventas por categoría
Ventas por región
Ranking de desempeño
Análisis de Clientes
Segmentación de clientes
Frecuencia de compra
Ticket promedio por segmento
Tendencias Temporales
Evolución de ventas
Comparativos mensuales
Estacionalidad

🔍 Análisis Realizados

Durante el desarrollo del proyecto se llevaron a cabo análisis como:

Identificación de productos con mayor rotación.
Detección de categorías con mejor desempeño.
Análisis de comportamiento de clientes.
Evaluación de tendencias de ventas.
Comparación de períodos.
Identificación de oportunidades de crecimiento comercial.
🚀 Resultados Esperados

El proyecto permite:

Transformar datos en información accionable.
Mejorar la comprensión del comportamiento de ventas.
Identificar oportunidades de optimización comercial.
Facilitar la toma de decisiones basada en datos.
Crear reportes visuales de fácil interpretación para usuarios de negocio.

🎓 Aprendizajes Adquiridos

Durante el desarrollo de RetailPro se fortalecieron competencias en:

SQL para análisis y transformación de datos.
Diseño de modelos dimensionales.
Procesos ETL con Power Query.
Desarrollo de medidas DAX.
Visualización de datos con Power BI.
Generación de insights de negocio.
Buenas prácticas en proyectos de Data Analytics.

👤 Autor

Mayra Cartagena
Data Analytics Student

📄 Licencia

Este proyecto fue desarrollado con fines académicos dentro de un programa de formación en Data Analytics y puede utilizarse como referencia para proyectos educativos y de portafolio profesional.
