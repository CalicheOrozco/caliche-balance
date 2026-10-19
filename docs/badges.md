# Imágenes de los logros

Cada logro busca su imagen en `public/badges/<archivo>.png`. Mientras no exista, la app muestra una medalla con un ícono, así que puedes subirlas poco a poco. Los logros bloqueados se muestran en gris automáticamente: no necesitas una versión "bloqueada".

## Cómo generarlas

1. Copia el **estilo base** y reemplaza `{TIER}` y `{SYMBOL}` con los valores de la tabla.
2. Pide **fondo transparente** y formato **PNG**, cuadrado (1:1).
   - **ChatGPT:** agrega al final "Transparent background, export as PNG".
   - **Ideogram:** si no da fondo transparente, quítalo después (en el Finder de macOS: clic derecho en la imagen > Acciones rápidas > Eliminar fondo).
3. Redúcela a **512 × 512 px** y que pese menos de 100 KB (la app las guarda para usarse sin internet).
4. Guárdala con el nombre exacto de la tabla en `public/badges/`.

Sin texto, letras ni números en la imagen: el nombre del logro lo pone la app en español o inglés, y los generadores de imágenes suelen escribir mal.

### Estilo base

```text
A circular achievement badge medallion for a health and fitness app. Flat vector illustration with subtle depth and soft highlights, centered, on a transparent background. Thick {TIER} metallic rim. Inner disc in deep green (#178a43) with a soft radial gradient to bright green (#21b359). In the center, one bold, simple white symbol: {SYMBOL}. Clean, modern and friendly, high contrast, readable at 64 pixels. No text, no letters, no numbers. Square 1:1 format.
```

### Colores del borde

| Nivel | `{TIER}` |
|---|---|
| Bronce | `bronze (gradient from #c98a4b to #7a4a1f)` |
| Plata | `silver (gradient from #e5e7eb to #8b95a3)` |
| Oro | `gold (gradient from #f6d365 to #c8961e)` |

## Lista de logros

| Archivo | Logro | Nivel | `{SYMBOL}` |
|---|---|---|---|
| `first-weigh-in.png` | Primer paso | Bronce | `a bare foot stepping onto a bathroom scale` |
| `streak-7.png` | Racha de 7 | Plata | `a lightning bolt with seven small dots in an arc above it` |
| `streak-30.png` | Racha de 30 | Oro | `a lightning bolt inside a ring of small dots, with tiny sparkles` |
| `habit-4.png` | Hábito en marcha | Plata | `a calendar page with three check marks` |
| `habit-12.png` | Hábito de hierro | Oro | `a calendar page in front of a strong shield` |
| `weighins-100.png` | Cien pesadas | Oro | `a bathroom scale framed by a laurel wreath` |
| `challenge-weeks-4.png` | Retador | Plata | `a check box with a check mark next to a small trophy` |
| `challenge-month.png` | Mes perfecto | Oro | `a monthly calendar grid with a star on top` |
| `loss-5.png` | Menos 5 % | Plata | `a bathroom scale with a bold downward arrow` |
| `loss-10.png` | Menos 10 % | Oro | `a bathroom scale with two bold downward arrows and a laurel wreath` |
| `fat-down-2.png` | Grasa a la baja | Plata | `a pie chart with one slice shrinking and a small downward arrow` |
| `recomposition.png` | Recomposición | Oro | `a flexed arm with a circular arrow around it` |
| `healthy-bmi.png` | IMC saludable | Oro | `a standing human silhouette inside a circle with a check mark` |
| `healthy-fat.png` | Grasa saludable | Oro | `a heart with a check mark` |
| `waist-first.png` | Cinta en mano | Bronce | `a coiled measuring tape` |
| `waist-healthy.png` | Cintura sana | Oro | `a measuring tape wrapped around a slim waist outline, with a check mark` |
| `score-60.png` | Puntuación 60 | Plata | `a semicircular gauge with the needle a little past the middle` |
| `score-80.png` | Puntuación 80 | Oro | `a semicircular gauge with the needle near the top and a small star` |
| `goal-1.png` | Meta cumplida | Plata | `a flag planted on a mountain peak` |
| `goal-3.png` | Tres metas | Oro | `three flags on three rising mountain peaks` |

### Ejemplo completo (Racha de 7)

```text
A circular achievement badge medallion for a health and fitness app. Flat vector illustration with subtle depth and soft highlights, centered, on a transparent background. Thick silver (gradient from #e5e7eb to #8b95a3) metallic rim. Inner disc in deep green (#178a43) with a soft radial gradient to bright green (#21b359). In the center, one bold, simple white symbol: a lightning bolt with seven small dots in an arc above it. Clean, modern and friendly, high contrast, readable at 64 pixels. No text, no letters, no numbers. Square 1:1 format.
```

Consejo: genera primero 2 o 3 y, cuando te guste el resultado, pide las demás en la misma conversación ("same style as the previous badge") para que todas combinen.
