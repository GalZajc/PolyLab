import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Droplets, X } from 'lucide-react';
import { FaceDefinition } from '../types';

interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface HSVColor {
  h: number;
  s: number;
  v: number;
}

interface ColorBucketPopupProps {
  targetFace?: FaceDefinition | null;
  initialColor?: string;
  uiTheme: 'light' | 'dark';
  title?: string;
  description?: string;
  applyLabel?: string;
  allowAlpha?: boolean;
  onClose: () => void;
  onApply: (cssColor: string) => void;
}

const WHEEL_SIZE = 220;
const WHEEL_RADIUS = WHEEL_SIZE / 2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hsvToRgb(hsv: HSVColor): RGBAColor {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp01(hsv.s);
  const v = clamp01(hsv.v);
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return {
    r: r + match,
    g: g + match,
    b: b + match,
    a: 1
  };
}

function rgbToHsv(color: RGBAColor): HSVColor {
  const r = clamp01(color.r);
  const g = clamp01(color.g);
  const b = clamp01(color.b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }

  return {
    h: (h + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max
  };
}

function parseHexColor(hexColor: string): RGBAColor {
  const normalized = hexColor.replace('#', '');
  if (normalized.length === 3) {
    return {
      r: parseInt(normalized[0] + normalized[0], 16) / 255,
      g: parseInt(normalized[1] + normalized[1], 16) / 255,
      b: parseInt(normalized[2] + normalized[2], 16) / 255,
      a: 1
    };
  }

  if (normalized.length === 6) {
    return {
      r: parseInt(normalized.slice(0, 2), 16) / 255,
      g: parseInt(normalized.slice(2, 4), 16) / 255,
      b: parseInt(normalized.slice(4, 6), 16) / 255,
      a: 1
    };
  }

  return { r: 1, g: 1, b: 1, a: 1 };
}

function parseCssColor(color: string): RGBAColor {
  if (typeof document === 'undefined') {
    return { r: 1, g: 1, b: 1, a: 1 };
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return { r: 1, g: 1, b: 1, a: 1 };

  context.fillStyle = '#ffffff';
  context.fillStyle = color;
  const normalized = context.fillStyle;

  if (normalized.startsWith('#')) {
    return parseHexColor(normalized);
  }

  const rgbaMatch = normalized.match(/rgba?\(([^)]+)\)/i);
  if (!rgbaMatch) return { r: 1, g: 1, b: 1, a: 1 };

  const [r, g, b, a] = rgbaMatch[1].split(',').map(value => Number.parseFloat(value.trim()));
  return {
    r: clamp01((r || 0) / 255),
    g: clamp01((g || 0) / 255),
    b: clamp01((b || 0) / 255),
    a: Number.isFinite(a) ? clamp01(a) : 1
  };
}

function rgbaToCss(color: RGBAColor): string {
  return `rgba(${Math.round(clamp01(color.r) * 255)}, ${Math.round(clamp01(color.g) * 255)}, ${Math.round(clamp01(color.b) * 255)}, ${clamp01(color.a).toFixed(4)})`;
}

export const ColorBucketPopup: React.FC<ColorBucketPopupProps> = ({
  targetFace = null,
  initialColor,
  uiTheme,
  title = 'Color Bucket',
  description,
  applyLabel = 'Apply Color',
  allowAlpha = true,
  onClose,
  onApply
}) => {
  const wheelRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState<RGBAColor>({ r: 1, g: 1, b: 1, a: 1 });
  const [channelInputs, setChannelInputs] = useState<Record<'r' | 'g' | 'b' | 'a', string>>({
    r: '1',
    g: '1',
    b: '1',
    a: '1'
  });

  useEffect(() => {
    const sourceColor = targetFace?.color || initialColor;
    if (!sourceColor) return;
    const parsedColor = parseCssColor(sourceColor);
    setColor(parsedColor);
    setChannelInputs({
      r: parsedColor.r.toString(),
      g: parsedColor.g.toString(),
      b: parsedColor.b.toString(),
      a: parsedColor.a.toString()
    });
  }, [initialColor, targetFace]);

  useEffect(() => {
    const canvas = wheelRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const image = context.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    for (let y = 0; y < WHEEL_SIZE; y += 1) {
      for (let x = 0; x < WHEEL_SIZE; x += 1) {
        const dx = x - WHEEL_RADIUS;
        const dy = y - WHEEL_RADIUS;
        const radius = Math.sqrt(dx * dx + dy * dy) / WHEEL_RADIUS;
        const pixelIndex = (y * WHEEL_SIZE + x) * 4;

        if (radius > 1) {
          image.data[pixelIndex + 3] = 0;
          continue;
        }

        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const rgb = hsvToRgb({ h: hue, s: radius, v: 1 });
        image.data[pixelIndex] = Math.round(rgb.r * 255);
        image.data[pixelIndex + 1] = Math.round(rgb.g * 255);
        image.data[pixelIndex + 2] = Math.round(rgb.b * 255);
        image.data[pixelIndex + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
  }, []);

  const previewColor = useMemo(() => rgbaToCss(color), [color]);
  const hsv = useMemo(() => rgbToHsv(color), [color]);
  const indicatorStyle = useMemo(() => {
    const angle = (hsv.h * Math.PI) / 180;
    const radius = hsv.s * WHEEL_RADIUS;
    return {
      left: `${WHEEL_RADIUS + Math.cos(angle) * radius}px`,
      top: `${WHEEL_RADIUS + Math.sin(angle) * radius}px`
    };
  }, [hsv]);

  const updateFromHsv = (nextHsv: HSVColor) => {
    const next = hsvToRgb(nextHsv);
    const nextColor = { ...next, a: color.a };
    setColor(nextColor);
    setChannelInputs({
      r: nextColor.r.toString(),
      g: nextColor.g.toString(),
      b: nextColor.b.toString(),
      a: nextColor.a.toString()
    });
  };

  const pickColorFromPoint = (clientX: number, clientY: number) => {
    const canvas = wheelRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - rect.width / 2;
    const dy = clientY - rect.top - rect.height / 2;
    const radius = Math.sqrt(dx * dx + dy * dy) / (rect.width / 2);
    if (radius > 1) return;

    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    updateFromHsv({ h: hue, s: radius, v: hsv.v });
  };

  return (
    <div
      className={`menu-panel absolute left-full top-0 z-[80] ml-2 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl ${uiTheme === 'dark' ? 'ui-theme-dark' : ''}`}
      onKeyDown={event => {
        if (event.target instanceof HTMLButtonElement) return;
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onApply(previewColor);
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Droplets size={16} className="text-sky-600" />
            {title}
          </div>
          <div className="text-[11px] text-gray-500">
            {description || (targetFace
              ? 'Pick a color on the wheel, then apply it to this polygon family.'
              : 'Pick a color on the wheel, then apply it here.')}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex justify-center">
          <div className="relative h-[220px] w-[220px]">
            <canvas
              ref={wheelRef}
              width={WHEEL_SIZE}
              height={WHEEL_SIZE}
              onMouseDown={event => pickColorFromPoint(event.clientX, event.clientY)}
              onMouseMove={event => {
                if ((event.buttons & 1) === 1) {
                  pickColorFromPoint(event.clientX, event.clientY);
                }
              }}
              className="h-full w-full cursor-crosshair rounded-full border border-gray-300 shadow-inner"
            />
            <div
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/25"
              style={{ ...indicatorStyle, backgroundColor: previewColor }}
            />
          </div>
        </div>

        <div className="menu-surface rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Current color
          <div className="mt-2 h-8 rounded-md border border-gray-300" style={{ backgroundColor: previewColor }} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Brightness</span>
            <span>{hsv.v.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={hsv.v}
            onChange={event => updateFromHsv({ ...hsv, v: Number.parseFloat(event.target.value) })}
            className="w-full accent-sky-600"
          />
        </div>

        <div className="space-y-2">
          {((allowAlpha ? ['r', 'g', 'b', 'a'] : ['r', 'g', 'b']) as ('r' | 'g' | 'b' | 'a')[]).map(channel => (
            <label key={channel} className="flex items-center gap-3">
              <span className="w-6 text-xs font-medium uppercase text-gray-500">{channel}</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={channelInputs[channel]}
                onChange={event => {
                  const nextValue = event.target.value;
                  setChannelInputs(prev => ({ ...prev, [channel]: nextValue }));
                  const numericValue = Number.parseFloat(nextValue);
                  if (Number.isFinite(numericValue)) {
                    setColor(prev => ({ ...prev, [channel]: clamp01(numericValue) }));
                  }
                }}
                onBlur={() => {
                  const numericValue = Number.parseFloat(channelInputs[channel]);
                  setChannelInputs(prev => ({
                    ...prev,
                    [channel]: Number.isFinite(numericValue) ? clamp01(numericValue).toString() : color[channel].toString()
                  }));
                }}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />
            </label>
          ))}
        </div>

        <button
          onClick={() => onApply(previewColor)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Check size={16} />
          {applyLabel}
        </button>
      </div>
    </div>
  );
};
