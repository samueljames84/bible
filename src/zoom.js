export const ZOOM_OPTIONS = Object.freeze([
  [100, "Normal (100%)"],
  [150, "Big (150%)"],
  [200, "Bigger (200%)"],
  [250, "Biggest (250%)"],
]);
export const DEFAULT_ZOOM = 100;

const ZOOM_LEVELS = ZOOM_OPTIONS.map(([level]) => level);
const LEGACY_FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 22, 24];
const LEGACY_ZOOM_LEVELS = LEGACY_FONT_SIZES.map((size) => size / 16 * 100);
const PREVIOUS_ZOOM_LEVELS = [80, 100, 125, 150, 200, 300, ...LEGACY_ZOOM_LEVELS];

export function readZoom(stored) {
  let zoom;
  if (stored.zoom !== undefined) {
    zoom = Number(stored.zoom);
    if (![...ZOOM_LEVELS, ...PREVIOUS_ZOOM_LEVELS].includes(zoom)) return DEFAULT_ZOOM;
  } else {
    const fontSize = Number(stored.fontSize);
    if (!LEGACY_FONT_SIZES.includes(fontSize)) return DEFAULT_ZOOM;
    zoom = fontSize / 16 * 100;
  }
  return ZOOM_LEVELS.reduce((nearest, level) =>
    Math.abs(level - zoom) < Math.abs(nearest - zoom) ? level : nearest);
}
