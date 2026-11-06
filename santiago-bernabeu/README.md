# Santiago Bernabéu

A pixel-art diorama of the Santiago Bernabéu, built with Three.js. The surrounding city is laid out from aerial photos, and the sky panel lets you change the time of day and the weather.

```sh
npm install
npm run dev
```

The round button at the bottom opens the sky panel. Drag to turn the world (it settles back on the nearest diamond angle when you let go) and use the wheel to zoom.

## Structure

- `src/core/pipeline.js`: low-resolution rendering, outlines, AO, dithering
- `src/world/stadium.js`: stadium model
- `src/world/plan.js`: road, block and landmark layout
- `src/world/city.js`: building generator and landmarks
- `src/world/ground.js`: ground painting and soil layers
- `src/world/life.js`: trees and street lamps
- `src/sky.js`: time and weather
