// pdf.js se importa solo en el servidor y solo para leer texto (lib/capture/pdf/extract.ts): se declara sin tipos para que el
// compilador no dependa de los de la librería (el worker ni siquiera los trae).
declare module "pdfjs-dist/legacy/build/pdf.mjs";
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
