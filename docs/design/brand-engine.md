# Brand engine

Convierte el color de un centro (cualquier hex) en cuatro tokens que cumplen WCAG AA en claro y oscuro. Vive en `yoclick-app/src/shared/theme/brand-engine.ts` (función pura, sin dependencias de React) y se replica en `yoclick-web`. El backend puede usarlo para avisar en el panel de marca, pero la app siempre lo recalcula.

## Entradas y salidas

```ts
interface BrandTokens {
  brand: string;     // el hex del centro, tal cual (solo rellenos)
  onBrand: string;   // '#000000' | '#FFFFFF' — texto/iconos sobre brand
  brandInk: string;  // brand como texto/icono sobre bg, surface y brandSoft
  brandSoft: string; // tinte de fondo
}
function deriveBrandTokens(brandHexColor: string, themeMode: 'light' | 'dark', themeNeutrals: { backgroundColor: string; surfaceColor: string }): BrandTokens;
```

## Algoritmo

1. **Normalizar** `hex` (`#abc` → `#AABBCC`, mayúsculas). Hex inválido → usar `ink` del tema (marca neutra).
2. **Luminancia relativa** WCAG 2.x: canal sRGB `c/255`; `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`; `L = 0.2126R + 0.7152G + 0.0722B`. Contraste `(L1+0.05)/(L2+0.05)`.
3. **on-brand**: el de mayor contraste con `brand` entre `#000000` y `#FFFFFF`. (Matemáticamente siempre ≥ 4,58:1.)
4. **brand-soft**: mezcla en sRGB de `brand` sobre `surface` con alfa **0,12** (claro) o **0,20** (oscuro). Redondear cada canal.
5. **brand-ink**: partir de `brand` y mezclar hacia `#000000` (claro) o `#FFFFFF` (oscuro) en pasos de **4 %** (`t = 0, 0.04, 0.08…`) hasta que el contraste sea **≥ 4,6:1** contra `surface`, `bg` **y** `brand-soft` a la vez. `mix(a, b, t) = round(a + (b − a)·t)` por canal. Tope `t = 1`.
6. Devolver los cuatro valores en `#RRGGBB` mayúsculas.

Neutros de referencia (`tokens.json`): claro `bg #F5F5F2`, `surface #FFFFFF`; oscuro `bg #0D0E10`, `surface #16181B`.

## Vectores de prueba (obligatorios en el test unitario)

| Marca | Tema | on-brand | brand-ink | brand-soft |
|---|---|---|---|---|
| `#E4572E` | claro | `#000000` | `#B64625` | `#FCEBE6` |
| `#E4572E` | oscuro | `#000000` | `#E8724F` | `#3F251F` |
| `#2446C7` | claro | `#FFFFFF` | `#2446C7` | `#E5E9F8` |
| `#2446C7` | oscuro | `#FFFFFF` | `#7389DB` | `#19213D` |
| `#C8F031` | claro | `#000000` | `#607318` | `#F8FDE6` |
| `#C8F031` | oscuro | `#000000` | `#C8F031` | `#3A431F` |

Propiedades a comprobar además (test por propiedades con 1.000 colores aleatorios, `fast-check`):

- `contrast(onBrand, brand) ≥ 4.5`
- `contrast(brandInk, surface) ≥ 4.5`, `contrast(brandInk, bg) ≥ 4.5`, `contrast(brandInk, brandSoft) ≥ 4.5`
- La función es pura y determinista.

## Reglas de uso

- `brand` **nunca** como color de texto.
- Sobre `brand` siempre `onBrand`.
- Texto e iconos activos de marca: `brandInk`.
- Fondo de pestaña activa, cabecera de próxima cita, avisos no leídos: `brandSoft` con texto `ink` o `brandInk`.
- Anillo de foco: `focus` (azul, independiente de la marca).
- En el editor de marca del admin, mostrar la vista previa en ambos temas y el contraste calculado.

## Implementación de referencia

```ts
type RgbChannels = [red: number, green: number, blue: number];
type ThemeMode = 'light' | 'dark';

interface ThemeNeutrals {
  backgroundColor: string;
  surfaceColor: string;
}

export interface BrandTokens {
  brand: string;
  onBrand: string;
  brandInk: string;
  brandSoft: string;
}

const MINIMUM_BRAND_INK_CONTRAST_RATIO = 4.6;
const BRAND_INK_MIX_STEP = 0.04;
const BRAND_SOFT_OPACITY_BY_MODE: Record<ThemeMode, number> = { light: 0.12, dark: 0.2 };
const BLACK_HEX = '#000000';
const WHITE_HEX = '#FFFFFF';

function convertHexToRgbChannels(hexColor: string): RgbChannels {
  const numericColor = parseInt(hexColor.slice(1), 16);
  return [(numericColor >> 16) & 255, (numericColor >> 8) & 255, numericColor & 255];
}

function convertRgbChannelsToHex(rgbChannels: readonly number[]): string {
  const hexPairs = rgbChannels.map((channelValue) => Math.round(channelValue).toString(16).padStart(2, '0'));
  return `#${hexPairs.join('').toUpperCase()}`;
}

function linearizeSrgbChannel(channelValue: number): number {
  const normalizedChannel = channelValue / 255;
  return normalizedChannel <= 0.04045
    ? normalizedChannel / 12.92
    : ((normalizedChannel + 0.055) / 1.055) ** 2.4;
}

function calculateRelativeLuminance(hexColor: string): number {
  const [red, green, blue] = convertHexToRgbChannels(hexColor);
  return 0.2126 * linearizeSrgbChannel(red) + 0.7152 * linearizeSrgbChannel(green) + 0.0722 * linearizeSrgbChannel(blue);
}

export function calculateContrastRatio(firstHexColor: string, secondHexColor: string): number {
  const [lighterLuminance, darkerLuminance] = [
    calculateRelativeLuminance(firstHexColor),
    calculateRelativeLuminance(secondHexColor),
  ].sort((first, second) => second - first) as [number, number];
  return (lighterLuminance + 0.05) / (darkerLuminance + 0.05);
}

function mixHexColors(baseHexColor: string, targetHexColor: string, targetWeight: number): string {
  const baseChannels = convertHexToRgbChannels(baseHexColor);
  const targetChannels = convertHexToRgbChannels(targetHexColor);
  const mixedChannels = baseChannels.map(
    (baseChannel, channelIndex) => baseChannel + ((targetChannels[channelIndex] ?? baseChannel) - baseChannel) * targetWeight,
  );
  return convertRgbChannelsToHex(mixedChannels);
}

function pickReadableTextColorOnBrand(brandHexColor: string): string {
  const contrastWithBlack = calculateContrastRatio(BLACK_HEX, brandHexColor);
  const contrastWithWhite = calculateContrastRatio(WHITE_HEX, brandHexColor);
  return contrastWithBlack >= contrastWithWhite ? BLACK_HEX : WHITE_HEX;
}

function findAccessibleBrandInk(brandHexColor: string, themeMode: ThemeMode, backgroundsToPass: readonly string[]): string {
  const mixTargetHexColor = themeMode === 'light' ? BLACK_HEX : WHITE_HEX;
  const maximumStepCount = Math.round(1 / BRAND_INK_MIX_STEP);
  for (let stepIndex = 0; stepIndex <= maximumStepCount; stepIndex += 1) {
    const candidateInk = mixHexColors(brandHexColor, mixTargetHexColor, stepIndex * BRAND_INK_MIX_STEP);
    const passesAllBackgrounds = backgroundsToPass.every(
      (backgroundHexColor) => calculateContrastRatio(candidateInk, backgroundHexColor) >= MINIMUM_BRAND_INK_CONTRAST_RATIO,
    );
    if (passesAllBackgrounds) return candidateInk;
  }
  return mixTargetHexColor;
}

export function deriveBrandTokens(brandHexColor: string, themeMode: ThemeMode, themeNeutrals: ThemeNeutrals): BrandTokens {
  const brand = brandHexColor.toUpperCase();
  const brandSoft = mixHexColors(themeNeutrals.surfaceColor, brand, BRAND_SOFT_OPACITY_BY_MODE[themeMode]);
  const brandInk = findAccessibleBrandInk(brand, themeMode, [themeNeutrals.surfaceColor, themeNeutrals.backgroundColor, brandSoft]);
  return { brand, onBrand: pickReadableTextColorOnBrand(brand), brandInk, brandSoft };
}
```

> La implementación debe reproducir exactamente la tabla de vectores; si un vector falla por redondeo, ajustar la implementación (no la tabla), comparando con el prototipo (`design/prototipo-yoclick.html`, función del motor de marca).
