import React, { useMemo, useState } from 'react';
import { Calculator, Check, X } from 'lucide-react';
import { FaceDefinition } from '../types';
import {
  createKiteFaceDefinition,
  createParallelogramFaceDefinition,
  createSymmetricPentagonFaceDefinition,
  createTrapezoidFaceDefinition,
  createTriangleFaceDefinition
} from '../utils/math';
import { CalculatorPopup } from './CalculatorPopup';

type BuilderKind = 'triangle' | 'kite' | 'trapezoid' | 'parallelogram' | 'pentagon';

interface ShapeBuilderPopupProps {
  kind: BuilderKind;
  top: number;
  uiTheme: 'light' | 'dark';
  onClose: () => void;
  onCreate: (definition: FaceDefinition) => void;
}

type FieldMap = Record<string, string>;

const fieldSections: Record<BuilderKind, Array<{ title: string; columns?: number; fields: Array<{ key: string; label: string; suffix: string; placeholder: string }> }>> = {
  triangle: [
    {
      title: 'Sides',
      columns: 3,
      fields: [
        { key: 'a', label: 'Side a', suffix: '', placeholder: '1' },
        { key: 'b', label: 'Side b', suffix: '', placeholder: '1' },
        { key: 'c', label: 'Side c', suffix: '', placeholder: '1' }
      ]
    },
    {
      title: 'Angles',
      columns: 3,
      fields: [
        { key: 'A', label: 'Angle A', suffix: 'deg', placeholder: '60' },
        { key: 'B', label: 'Angle B', suffix: 'deg', placeholder: '60' },
        { key: 'C', label: 'Angle C', suffix: 'deg', placeholder: '60' }
      ]
    },
    {
      title: 'Heights',
      columns: 3,
      fields: [
        { key: 'ha', label: 'Height ha', suffix: '', placeholder: 'optional' },
        { key: 'hb', label: 'Height hb', suffix: '', placeholder: 'optional' },
        { key: 'hc', label: 'Height hc', suffix: '', placeholder: 'optional' }
      ]
    }
  ],
  kite: [
    {
      title: 'Deltoid',
      fields: [
        { key: 'sideA', label: 'Top side pair', suffix: '', placeholder: '1' },
        { key: 'sideB', label: 'Bottom side pair', suffix: '', placeholder: '0.7' },
        { key: 'angle', label: 'Top angle', suffix: 'deg', placeholder: '72' }
      ]
    }
  ],
  trapezoid: [
    {
      title: 'Trapezoid',
      fields: [
        { key: 'topWidth', label: 'Top width', suffix: '', placeholder: '0.8' },
        { key: 'bottomWidth', label: 'Bottom width', suffix: '', placeholder: '1.2' },
        { key: 'height', label: 'Height', suffix: '', placeholder: '0.8' },
        { key: 'offset', label: 'Top offset', suffix: '', placeholder: '0.2' }
      ]
    }
  ],
  parallelogram: [
    {
      title: 'Parallelogram',
      fields: [
        { key: 'baseWidth', label: 'Base width', suffix: '', placeholder: '1' },
        { key: 'sideLength', label: 'Side length', suffix: '', placeholder: '0.8' },
        { key: 'angle', label: 'Left bottom angle', suffix: 'deg', placeholder: '65' }
      ]
    }
  ],
  pentagon: [
    {
      title: 'Symmetry',
      fields: [
        { key: 'baseWidth', label: 'Base width', suffix: '', placeholder: '1.2' },
        { key: 'shoulderWidth', label: 'Shoulder width', suffix: '', placeholder: '0.8' },
        { key: 'wallHeight', label: 'Wall height', suffix: '', placeholder: '0.5' },
        { key: 'roofHeight', label: 'Roof height', suffix: '', placeholder: '0.6' }
      ]
    }
  ]
};

const initialValues: Record<BuilderKind, FieldMap> = {
  triangle: { a: '', b: '', c: '', A: '', B: '', C: '', ha: '', hb: '', hc: '' },
  kite: { sideA: '1', sideB: '0.7', angle: '72' },
  trapezoid: { topWidth: '0.8', bottomWidth: '1.2', height: '0.8', offset: '0.2' },
  parallelogram: { baseWidth: '1', sideLength: '0.8', angle: '65' },
  pentagon: { baseWidth: '1.2', shoulderWidth: '0.8', wallHeight: '0.5', roofHeight: '0.6' }
};

const titles: Record<BuilderKind, string> = {
  triangle: 'Arbitrary Triangle',
  kite: 'Deltoid / Kite',
  trapezoid: 'Trapezoid',
  parallelogram: 'Parallelogram',
  pentagon: 'Symmetric Pentagon'
};

function parseValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function solveTriangle(fields: FieldMap): { a: number; b: number; c: number } | null {
  const a = parseValue(fields.a);
  const b = parseValue(fields.b);
  const c = parseValue(fields.c);
  const A = parseValue(fields.A);
  const B = parseValue(fields.B);
  const C = parseValue(fields.C);

  if (a && b && c) {
    return { a, b, c };
  }

  if (a && b && C) {
    const cSolved = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C * Math.PI / 180));
    return cSolved > 0 ? { a, b, c: cSolved } : null;
  }
  if (b && c && A) {
    const aSolved = Math.sqrt(b * b + c * c - 2 * b * c * Math.cos(A * Math.PI / 180));
    return aSolved > 0 ? { a: aSolved, b, c } : null;
  }
  if (c && a && B) {
    const bSolved = Math.sqrt(c * c + a * a - 2 * c * a * Math.cos(B * Math.PI / 180));
    return bSolved > 0 ? { a, b: bSolved, c } : null;
  }

  const solveFromSideAndAngles = (knownSide: number | null, knownAngleKey: 'a' | 'b' | 'c') => {
    if (!knownSide) return null;
    const angleA = A ?? (B && C ? 180 - B - C : null);
    const angleB = B ?? (A && C ? 180 - A - C : null);
    const angleC = C ?? (A && B ? 180 - A - B : null);
    if (!angleA || !angleB || !angleC) return null;
    if (angleA <= 0 || angleB <= 0 || angleC <= 0) return null;

    const sinA = Math.sin(angleA * Math.PI / 180);
    const sinB = Math.sin(angleB * Math.PI / 180);
    const sinC = Math.sin(angleC * Math.PI / 180);

    if (knownAngleKey === 'a' && sinA > 0) {
      return { a: knownSide, b: knownSide * sinB / sinA, c: knownSide * sinC / sinA };
    }
    if (knownAngleKey === 'b' && sinB > 0) {
      return { a: knownSide * sinA / sinB, b: knownSide, c: knownSide * sinC / sinB };
    }
    if (knownAngleKey === 'c' && sinC > 0) {
      return { a: knownSide * sinA / sinC, b: knownSide * sinB / sinC, c: knownSide };
    }
    return null;
  };

  return solveFromSideAndAngles(a, 'a') || solveFromSideAndAngles(b, 'b') || solveFromSideAndAngles(c, 'c');
}

function describeTriangle(fields: FieldMap) {
  const solved = solveTriangle(fields);
  if (!solved) {
    return 'Supported triangle inputs: SSS, SAS, or one side plus two angles.';
  }

  const { a, b, c } = solved;
  const angleA = Math.acos((b * b + c * c - a * a) / (2 * b * c)) * 180 / Math.PI;
  const angleB = Math.acos((a * a + c * c - b * b) / (2 * a * c)) * 180 / Math.PI;
  const angleC = 180 - angleA - angleB;
  const area = Math.max(0, Math.sqrt(Math.max(0, (a + b + c) * (-a + b + c) * (a - b + c) * (a + b - c))) / 4);
  const ha = area > 0 ? (2 * area) / a : 0;
  const hb = area > 0 ? (2 * area) / b : 0;
  const hc = area > 0 ? (2 * area) / c : 0;

  return `Solved triangle: angles ${angleA.toFixed(2)}°, ${angleB.toFixed(2)}°, ${angleC.toFixed(2)}°; heights ${ha.toFixed(3)}, ${hb.toFixed(3)}, ${hc.toFixed(3)}.`;
}

export const ShapeBuilderPopup: React.FC<ShapeBuilderPopupProps> = ({ kind, top, uiTheme, onClose, onCreate }) => {
  const [values, setValues] = useState<FieldMap>(initialValues[kind]);
  const [error, setError] = useState<string | null>(null);
  const [activeCalcField, setActiveCalcField] = useState<string | null>(null);

  const helperText = useMemo(() => {
    if (kind !== 'triangle') return null;
    return describeTriangle(values);
  }, [kind, values]);

  const handleApply = () => {
    let definition: FaceDefinition | null = null;

    if (kind === 'triangle') {
      const solved = solveTriangle(values);
      if (solved) {
        definition = createTriangleFaceDefinition(solved.a, solved.b, solved.c);
      }
    } else if (kind === 'kite') {
      const sideA = parseValue(values.sideA);
      const sideB = parseValue(values.sideB);
      const angle = parseValue(values.angle);
      if (sideA && sideB && angle) {
        definition = createKiteFaceDefinition(sideA, sideB, angle);
      }
    } else if (kind === 'trapezoid') {
      const topWidth = parseValue(values.topWidth);
      const bottomWidth = parseValue(values.bottomWidth);
      const height = parseValue(values.height);
      const offset = parseValue(values.offset);
      if (topWidth && bottomWidth && height && offset !== null) {
        definition = createTrapezoidFaceDefinition(topWidth, bottomWidth, height, offset);
      }
    } else if (kind === 'parallelogram') {
      const baseWidth = parseValue(values.baseWidth);
      const sideLength = parseValue(values.sideLength);
      const angle = parseValue(values.angle);
      if (baseWidth && sideLength && angle) {
        definition = createParallelogramFaceDefinition(baseWidth, sideLength, angle);
      }
    } else if (kind === 'pentagon') {
      const baseWidth = parseValue(values.baseWidth);
      const shoulderWidth = parseValue(values.shoulderWidth);
      const wallHeight = parseValue(values.wallHeight);
      const roofHeight = parseValue(values.roofHeight);
      if (baseWidth && shoulderWidth && wallHeight !== null && roofHeight) {
        definition = createSymmetricPentagonFaceDefinition(baseWidth, shoulderWidth, wallHeight, roofHeight);
      }
    }

    if (!definition) {
      setError('Those values do not define a valid polygon yet.');
      return;
    }

    onCreate(definition);
    onClose();
  };

  const calcInitialValue = activeCalcField ? parseValue(values[activeCalcField]) ?? 0 : 0;
  const maxTop = typeof window === 'undefined' ? top : window.innerHeight - 32;

  return (
    <>
      <div
        className={`menu-panel absolute left-full z-50 ml-2 max-h-[calc(100vh-1rem)] w-[460px] max-w-[calc(100vw-6rem)] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl ${uiTheme === 'dark' ? 'ui-theme-dark' : ''}`}
        style={{ top: Math.max(0, Math.min(top, maxTop)) }}
        onKeyDown={event => {
          if (event.target instanceof HTMLButtonElement) return;
          if (event.key !== 'Enter' || activeCalcField) return;
          event.preventDefault();
          handleApply();
        }}
      >
        <div className="menu-subtle flex items-center justify-between bg-gray-50 border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-base font-semibold text-gray-800">{titles[kind]}</div>
            <div className="text-xs text-gray-500">Enter ratios or lengths. PolyLab keeps the exact proportions you type.</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-4">
            {fieldSections[kind].map(section => (
              <section key={section.title} className="space-y-2">
                {kind === 'triangle' && (
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</div>
                )}
                <div className={`grid gap-3 ${section.columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                  {section.fields.map(field => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">{field.label}</span>
                      <div className="menu-surface flex items-center rounded-lg border border-gray-300 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                        <input
                          type="text"
                          value={values[field.key]}
                          placeholder={field.placeholder}
                          onChange={event => {
                            setValues(prev => ({ ...prev, [field.key]: event.target.value }));
                            setError(null);
                          }}
                          className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-sm text-gray-800 outline-none"
                        />
                        {field.suffix && <span className="px-2 text-xs text-gray-400">{field.suffix}</span>}
                        <button
                          type="button"
                          onClick={() => setActiveCalcField(field.key)}
                          className="border-l border-gray-200 px-2 text-gray-400 hover:text-blue-600"
                          title={`Open calculator for ${field.label}`}
                        >
                          <Calculator size={15} />
                        </button>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {helperText && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {helperText}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="menu-subtle flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4">
          <button onClick={onClose} className="menu-hover rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleApply} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Check size={16} />
            Use Shape
          </button>
        </div>
      </div>

      {activeCalcField && (
        <CalculatorPopup
          initialValue={calcInitialValue}
          uiTheme={uiTheme}
          onClose={() => setActiveCalcField(null)}
          onApply={value => {
            setValues(prev => ({ ...prev, [activeCalcField]: Number.isFinite(value) ? value.toString() : prev[activeCalcField] }));
            setActiveCalcField(null);
            setError(null);
          }}
        />
      )}
    </>
  );
};
