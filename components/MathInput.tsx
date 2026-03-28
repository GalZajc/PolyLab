
import React, { useState, useEffect, useRef } from 'react';

interface MathInputProps {
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  className?: string;
}

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return '';
  return value.toPrecision(17);
};

export const MathInput: React.FC<MathInputProps> = ({ value, onChange, onCommit, className }) => {
  const [strVal, setStrVal] = useState(formatNumber(value));
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with external value when not being edited by user
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
       setStrVal(formatNumber(value));
    }
  }, [value]);

  const evaluate = (expr: string): number | null => {
    try {
      let sanitized = expr.toLowerCase().trim();
      if (!sanitized) return null;
      
      // Replace constants
      sanitized = sanitized.replace(/\bpi\b/g, 'Math.PI');
      sanitized = sanitized.replace(/\be\b/g, 'Math.E');
      
      // Replace functions
      const funcs = ['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'abs', 'pow', 'log', 'exp', 'floor', 'ceil', 'round'];
      funcs.forEach(f => {
          sanitized = sanitized.replace(new RegExp(`\\b${f}\\b`, 'g'), `Math.${f}`);
      });
      
      // Allow math operators, parens, and numbers
      if (/[^0-9\.\+\-\*\/\(\)\s\^Math\._\,]/.test(sanitized)) return null;

      // Handle caret for power
      sanitized = sanitized.replace(/\^/g, '**');

      const fn = new Function(`return ${sanitized};`);
      const result = fn();
      
      if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
        return result;
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStrVal(val);
    const res = evaluate(val);
    
    // If valid, update parent immediately for live feedback
    if (res !== null) {
        setError(false);
        onChange(res); 
    } else {
        // If invalid (typing...), just set error state but don't update parent value yet
        setError(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur(); // Triggers onBlur
    }
    // Prevent app-level shortcuts (like arrow keys for rotation) while typing
    e.stopPropagation();
  };

  const handleBlur = () => {
    const res = evaluate(strVal);
    if (res !== null) {
        setError(false);
        setStrVal(formatNumber(res));
        onCommit();
    } else {
        // Revert to last valid value
        setStrVal(formatNumber(value));
        setError(false);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={strVal}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={`outline-none bg-transparent font-mono text-sm text-right w-full ${className} ${error ? 'text-red-500' : 'text-gray-700'}`}
    />
  );
};
