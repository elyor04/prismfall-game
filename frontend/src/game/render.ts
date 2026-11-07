// Pre-rendered glow sprites. Drawing shadowBlur at runtime is expensive, so
// every glowing shape is rasterised once into an offscreen canvas and then
// blitted with drawImage.

import type { Shape } from "./content";
import { TAU } from "./math";

type AnyCanvas = HTMLCanvasElement;

export interface Sprite {
  c: AnyCanvas;
  /** World-space size of the whole image (shape plus glow padding). */
  full: number;
}

const RES = 2; // sprite pixels per world unit
const cache = new Map<string, Sprite>();

function makeCanvas(w: number, h: number): AnyCanvas {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function pathShape(ctx: CanvasRenderingContext2D, shape: Shape | "player", r: number) {
  ctx.beginPath();
  const poly = (n: number, rot = -Math.PI / 2, rr = r) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  switch (shape) {
    case "tri":
      ctx.moveTo(r, 0);
      ctx.lineTo(-0.75 * r, 0.8 * r);
      ctx.lineTo(-0.35 * r, 0);
      ctx.lineTo(-0.75 * r, -0.8 * r);
      ctx.closePath();
      break;
    case "player":
      ctx.moveTo(1.25 * r, 0);
      ctx.lineTo(-0.8 * r, 0.85 * r);
      ctx.lineTo(-0.35 * r, 0);
      ctx.lineTo(-0.8 * r, -0.85 * r);
      ctx.closePath();
      break;
    case "diamond":
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(0, 0.55 * r);
      ctx.lineTo(-r * 0.9, 0);
      ctx.lineTo(0, -0.55 * r);
      ctx.closePath();
      break;
    case "square":
      poly(4, Math.PI / 4, r * 1.05);
      break;
    case "pent":
      poly(5, 0);
      break;
    case "hex":
      poly(6, 0);
      break;
    case "star": {
      const n = 8;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU;
        const rr = i % 2 === 0 ? r : r * 0.55;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "boss": {
      const n = 6;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.62;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "ring":
    case "circle":
    default:
      ctx.arc(0, 0, r, 0, TAU);
  }
}

/**
 * A neon outlined shape with an inner tint and soft glow. `flash` renders a
 * solid white version used for the hit-flash frame.
 */
export function shapeSprite(shape: Shape | "player", color: string, r: number, flash = false, fillAlpha = 0.18): Sprite {
  const key = `s|${shape}|${color}|${r}|${flash ? 1 : 0}|${fillAlpha}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const glow = r * 0.9 + 8;
  const full = (r * 1.3 + glow) * 2;
  const c = makeCanvas(full * RES, full * RES);
  const ctx = c.getContext("2d")!;
  ctx.scale(RES, RES);
  ctx.translate(full / 2, full / 2);
  ctx.lineJoin = "round";
  const lw = Math.max(1.6, r * 0.16);

  ctx.shadowColor = color;
  ctx.shadowBlur = glow * RES * 0.9;
  pathShape(ctx, shape, r);
  if (flash) {
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  } else {
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    // A second, sharper pass so the outline reads crisp over the glow.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = mixWhite(color);
    ctx.lineWidth = lw * 0.45;
    pathShape(ctx, shape, r);
    ctx.stroke();
  }
  const s = { c, full };
  cache.set(key, s);
  return s;
}

/** Soft radial glow dot used by particles, bullets and pickups. */
export function glowSprite(color: string, r: number, core = 0.35): Sprite {
  const key = `g|${color}|${r}|${core}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const full = r * 2;
  const px = Math.max(8, Math.ceil(full * RES));
  const c = makeCanvas(px, px);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(core, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  const s = { c, full };
  cache.set(key, s);
  return s;
}

/** Thin ring used for shockwaves and pickup radius cues. */
export function ringSprite(color: string, r: number, width: number): Sprite {
  const key = `r|${color}|${r}|${width}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = width * 3 + 6;
  const full = (r + pad) * 2;
  const c = makeCanvas(full, full);
  const ctx = c.getContext("2d")!;
  ctx.translate(full / 2, full / 2);
  ctx.shadowColor = color;
  ctx.shadowBlur = pad;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  const s = { c, full };
  cache.set(key, s);
  return s;
}

export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, scale = 1) {
  const f = s.full * scale;
  ctx.drawImage(s.c, x - f / 2, y - f / 2, f, f);
}

export function drawSpriteRot(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, rot: number, scale = 1) {
  const f = s.full * scale;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.drawImage(s.c, -f / 2, -f / 2, f, f);
  ctx.rotate(-rot);
  ctx.translate(-x, -y);
}

/** Lighten a #rrggbb colour halfway to white (used for crisp inner strokes). */
export function mixWhite(color: string, t = 0.55) {
  if (!color.startsWith("#") || color.length !== 7) return "#ffffff";
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/** A tile of stars for one parallax layer. */
export function starTile(size: number, count: number, maxR: number, seed: number): AnyCanvas {
  const c = makeCanvas(size, size);
  const ctx = c.getContext("2d")!;
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const tints = ["#ffffff", "#bfe6ff", "#d9c8ff", "#ffd6f0"];
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.4 + rnd() * maxR;
    ctx.globalAlpha = 0.25 + rnd() * 0.75;
    ctx.fillStyle = tints[Math.floor(rnd() * tints.length)];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  return c;
}

/** Low-resolution nebula backdrop, scaled up when drawn so it stays soft. */
export function nebula(w: number, h: number): AnyCanvas {
  const c = makeCanvas(Math.max(64, w / 4), Math.max(64, h / 4));
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.fillStyle = "#07061A";
  ctx.fillRect(0, 0, W, H);
  const blob = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(7,6,26,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const m = Math.max(W, H);
  blob(W * 0.15, H * 0.2, m * 0.55, "rgba(70,40,160,0.55)");
  blob(W * 0.9, H * 0.85, m * 0.6, "rgba(160,30,120,0.35)");
  blob(W * 0.65, H * 0.1, m * 0.35, "rgba(30,110,170,0.28)");
  return c;
}
