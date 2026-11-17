# Colonia de hormigas y feromonas

Simulación web de una colonia de hormigas que busca comida y acorta sus rutas con feromonas. Cuando el entorno cambia, la colonia se reajusta. Proyecto de **Computación Bioinspirada** — Laura Vanessa Bornacelli Parra.

Está hecha con HTML, CSS y JavaScript puro. No usa frameworks, backend ni build.

## Estructura
- `index.html`, `style.css`: página y diseño (responsive).
- `js/cerebro.js`: red neuronal de cada hormiga (5 entradas → 4 ocultas tanh → 3 salidas softmax, pesos fijos comentados).
- `js/simulacion.js`: mundo, hormigas, feromonas, escenarios e indicadores.
- `js/interfaz.js`: controles, dibujo, gráfico y descarga del CSV.

## Cómo usarla
1. Elige un escenario (Básico, Dos caminos, Obstáculo, Comida que se mueve, Varias fuentes) y pulsa **Iniciar**.
2. Ajusta hormigas, evaporación, exploración y velocidad (se aplican en vivo).
3. Con "Poner comida, "Dibujar obstáculos o "Borrar modificas el mapa con clic/arrastre; cada cambio queda marcado en el gráfico.
4. Marca "Ver la red neuronal y haz clic en una hormiga para ver entradas, probabilidades y decisión en tiempo real.
5. **Descargar resultados (CSV)** exporta escenario, parámetros e indicadores cada 5 s simulados (30 pasos = 1 s simulado).

Indicadores: comida total y por minuto, tiempo hasta la primera comida, tiempo de recuperación (tiempo hasta volver al 80 % de la recolección previa al cambio, tras haber caído por debajo de ese nivel) y % de uso de la ruta corta en "Dos caminos.

El CSV usa coma como separador y punto decimal; en Excel en español, impórtalo con *Datos → Desde texto/CSV*.

## Ejecutar localmente
Abre `index.html` en el navegador (o `python -m http.server` y entra a `localhost:8000`).

## Desplegar en Vercel
1. Crea un repositorio en GitHub y sube los archivos:
   ```
   git init
   git add .
   git commit -m "Simulación de hormigas"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
2. En vercel.com entra con GitHub → **Add New… → Project** → importa el repositorio.
3. Configura: **Framework Preset: Other**, Build Command vacío, Output Directory vacío (raíz).
4. Pulsa **Deploy**. Cada `git push` a `main` redespliega automáticamente.
