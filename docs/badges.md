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
| `steps-10k.png` | 10 mil pasos | das 10,000 pasos en un día | `a pair of footprints with a small "10K" banner above them` |
| `steps-15k.png` | 15 mil pasos | das 15,000 pasos en un día | `a pair of footprints with a small "15K" banner above them` |
| `steps-20k.png` | 20 mil pasos | das 20,000 pasos en un día | `a pair of footprints with a small "20K" banner and tiny sparkles` |
| `steps-week.png` | Semana caminando | das 7,000 pasos 5 días de una semana | `a winding path of footprints across a calendar week` |
| `steps-streak-7.png` | Racha caminando | llevas 7 días seguidos con 7,000 pasos | `footprints in a row with a lightning bolt and seven small dots` |
| `distance-5k.png` | 5 km en un día | caminas o corres 5 km en un día | `a road sign showing 5 km` |
| `distance-week.png` | Maratón semanal | sumas 42.2 km en una semana | `a finish line ribbon with a small medal` |
| `flights-10.png` | 10 pisos | subes 10 pisos en un día | `a staircase with an upward arrow` |
| `stand-3h.png` | 3 horas de pie | pasas 3 horas de pie en un día | `a standing human silhouette next to a small clock` |
| `exercise-30.png` | 30 de ejercicio | haces 30 minutos de ejercicio en un día | `a running shoe in motion with a small stopwatch` |
| `exercise-60.png` | Hora de ejercicio | haces 60 minutos de ejercicio en un día | `a stopwatch showing a full hour` |
| `exercise-150.png` | 150 a la semana | sumas 150 minutos de ejercicio en una semana | `a stopwatch with a ring filled halfway and a check mark` |
| `exercise-300.png` | 300 a la semana | sumas 300 minutos de ejercicio en una semana | `a stopwatch with a ring filled all the way and a star` |
| `exercise-streak-7.png` | Racha de ejercicio | llevas 7 días seguidos con 30 minutos de ejercicio | `a dumbbell with a lightning bolt and seven small dots` |
| `exercise-streak-30.png` | Mes de ejercicio | llevas 30 días seguidos con 30 minutos de ejercicio | `a dumbbell inside a ring of many small dots` |
| `active-500.png` | 500 activas | quemas 500 calorías activas en un día | `a small flame` |
| `active-1000.png` | 1,000 activas | quemas 1,000 calorías activas en un día | `a large bright flame` |
| `active-week.png` | Medio kilo quemado | quemas 3,500 calorías activas en una semana | `a flame over a small downward arrow` |
| `sleep-7.png` | Buen descanso | duermes 7 horas o más | `a crescent moon over a pillow with small stars` |
| `sleep-week.png` | Semana descansada | duermes 7 horas 5 noches de una semana | `a crescent moon with five stars in an arc` |
| `sleep-streak-7.png` | Racha de descanso | duermes 7 horas 7 noches seguidas | `a crescent moon with a lightning bolt and seven small dots` |
| `sleep-deep.png` | Sueño profundo | tienes 15 % o más de sueño profundo | `a crescent moon sinking into soft waves` |
| `sleep-unbroken.png` | Noche de corrido | duermes 6 horas sin despertarte | `a crescent moon inside an unbroken circle` |
| `sleep-regular.png` | Horario regular | te duermes 5 noches dentro de la misma hora | `a crescent moon next to a small clock` |
| `resting-hr-60.png` | Pulso bajo 60 | tu pulso en reposo queda debajo de 60 | `a calm heart with a gentle flat pulse line` |
| `resting-hr-down.png` | Corazón más fuerte | tu pulso en reposo del mes baja 2 latidos | `a heart with a small downward arrow` |
| `hrv-up.png` | Mejor recuperación | tu HRV del mes sube 5 % | `a heart with a varied pulse line and a small upward arrow` |
| `oxygen-week.png` | Oxígeno en orden | tu oxígeno de la semana promedia 95 % o más | `a pair of lungs with a check mark` |
| `full-day.png` | Día completo | cumples pasos, ejercicio y sueño en un día | `a sun, a footprint and a moon in one circle` |
| `full-week.png` | Semana completa de hábitos | tienes 5 días completos en una semana | `a calendar week with a star on each of five days` |

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
