# Imágenes de los logros

Cada logro tiene **una sola imagen**, en `public/badges/<archivo>.png`: **solo el símbolo, en blanco, sobre fondo transparente**. La app usa la forma del símbolo y la pinta del color de su nivel, y dibuja el fondo y el marco de ese nivel (Bronce, Plata, Oro, Platino o Diamante). Así toda la medalla cambia de color al subir de nivel con una sola imagen. Mientras no exista, la app muestra un ícono, así que puedes subirlas poco a poco.

## Cómo generarlas

1. Copia el **estilo base** y reemplaza `{SYMBOL}` con el de la tabla.
2. Formato **PNG**, cuadrado (1:1), con **fondo transparente**. Es indispensable: lo que no sea transparente se pinta del color del nivel.
   - **ChatGPT:** pide "Transparent background, export as PNG".
   - **Ideogram:** si no da fondo transparente, quítalo después (en el Finder de macOS: clic derecho en la imagen > Acciones rápidas > Eliminar fondo).
3. Redúcela a **512 × 512 px** y que pese menos de 100 KB (la app las guarda para usarse sin internet).
4. Guárdala con el nombre exacto de la tabla en `public/badges/`.

Sin texto, letras ni números: el nombre del logro y su nivel los pone la app en español o inglés, y los generadores de imágenes suelen escribir mal. Sin círculo, fondo ni marco: esos los dibuja la app.

### Estilo base

```text
A single bold, simple icon symbol for a fitness app achievement badge: {SYMBOL}. Solid pure white shape only, on a fully transparent background. Flat vector silhouette with clean rounded edges, no outlines, no gradients, no shadows, no circle, no background shape, no frame, no text, no letters, no numbers. Centered with some empty space around it, readable at 32 pixels. Square 1:1 format, PNG.
```

## Lista de logros

| Archivo | Logro | Cuenta cada vez que... | `{SYMBOL}` |
|---|---|---|---|
| `weigh-days.png` | Pesadas | te pesas en un día | `a bare foot stepping onto a bathroom scale` |
| `streak-7.png` | Racha de 7 | llevas 7 días seguidos | `a lightning bolt with seven small dots in an arc above it` |
| `streak-30.png` | Racha de 30 | llevas 30 días seguidos | `a lightning bolt inside a ring of many small dots, with tiny sparkles` |
| `habit-week.png` | Semana activa | te pesas 3 días en una semana | `a calendar page with three check marks` |
| `challenge-week.png` | Reto semanal | te pesas 5 días en una semana | `a check box with a check mark next to a small trophy` |
| `challenge-full.png` | Semana completa | haces 3 pesadas completas en una semana | `a bathroom scale with two footprints and small electric waves` |
| `challenge-month.png` | Mes perfecto | te pesas 20 días en un mes | `a monthly calendar grid with a star on top` |
| `loss-5.png` | Menos 5 % | bajas otro 5 % de peso | `a bathroom scale with a bold downward arrow` |
| `fat-down-2.png` | Grasa a la baja | bajas otros 2 puntos de grasa | `a pie chart with one slice shrinking and a small downward arrow` |
| `recomposition.png` | Recomposición | pierdes grasa sin perder músculo | `a flexed arm with a circular arrow around it` |
| `healthy-bmi.png` | IMC saludable | pasas una semana con IMC menor a 25 | `a standing human silhouette inside a circle with a check mark` |
| `healthy-fat.png` | Grasa saludable | pasas una semana con grasa en rango | `a heart with a check mark` |
| `waist-month.png` | Cinta en mano | registras tu cintura en un mes | `a coiled measuring tape` |
| `waist-healthy.png` | Cintura sana | pasas una semana con cintura sana | `a measuring tape wrapped around a slim waist outline, with a check mark` |
| `score-60.png` | Puntuación 60 | pasas una semana con puntuación de 60 o más | `a semicircular gauge with the needle a little past the middle` |
| `score-80.png` | Puntuación 80 | pasas una semana con puntuación de 80 o más | `a semicircular gauge with the needle near the top and a small star` |
| `goal.png` | Meta cumplida | cumples una meta | `a flag planted on a mountain peak` |

### Ejemplo completo (Racha de 7)

```text
A single bold, simple icon symbol for a fitness app achievement badge: a lightning bolt with seven small dots in an arc above it. Solid pure white shape only, on a fully transparent background. Flat vector silhouette with clean rounded edges, no outlines, no gradients, no shadows, no circle, no background shape, no frame, no text, no letters, no numbers. Centered with some empty space around it, readable at 32 pixels. Square 1:1 format, PNG.
```

Consejo: genera primero 2 o 3 y, cuando te guste el resultado, pide las demás en la misma conversación ("same style as the previous symbol") para que todas combinen.

## Niveles

| Nivel | Marco | Centro y símbolo | Veces para llegar (según el logro) |
|---|---|---|---|
| Bloqueado | gris | gris | todavía no |
| Bronce | cobre | café con símbolo durazno | la primera vez |
| Plata | plateado | gris acero con símbolo blanco | de 2 a 30 veces |
| Oro | dorado | dorado con símbolo crema | de 3 a 100 veces |
| Platino | platino azulado | azul acero con símbolo blanco | de 5 a 250 veces |
| Diamante | brillo de colores | cian a violeta, con brillo | de 8 a 500 veces |

Los números exactos de cada logro están en `shared/achievements.ts` (`BADGES`).
