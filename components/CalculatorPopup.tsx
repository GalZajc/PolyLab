
import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Calculator } from 'lucide-react';

interface CalculatorProps {
  initialValue: number;
  uiTheme: 'light' | 'dark';
  onClose: () => void;
  onApply: (value: number) => void;
}

export const CalculatorPopup: React.FC<CalculatorProps> = ({ initialValue, uiTheme, onClose, onApply }) => {
  const [expression, setExpression] = useState(initialValue.toString());
  const [mode, setMode] = useState<'DEG' | 'RAD'>('DEG');
  const [preview, setPreview] = useState<number | string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Perform initial evaluation
    evaluate(initialValue.toString(), 'DEG');
  }, []);

  const evaluate = (expr: string, currentMode: 'DEG' | 'RAD'): number | string => {
    try {
      if (!expr.trim()) {
        setPreview('');
        return '';
      }

      // Pre-processing: Replace symbols for JS compatibility
      let sanitized = expr.replace(/\^/g, '**');
      sanitized = sanitized.replace(/√/g, 'sqrt');
      
      // Create a safe evaluation context with math functions
      const context = {
        sin: (x: number) => Math.sin(currentMode === 'DEG' ? x * Math.PI / 180 : x),
        cos: (x: number) => Math.cos(currentMode === 'DEG' ? x * Math.PI / 180 : x),
        tan: (x: number) => Math.tan(currentMode === 'DEG' ? x * Math.PI / 180 : x),
        asin: (x: number) => { const r = Math.asin(x); return currentMode === 'DEG' ? r * 180 / Math.PI : r; },
        acos: (x: number) => { const r = Math.acos(x); return currentMode === 'DEG' ? r * 180 / Math.PI : r; },
        atan: (x: number) => { const r = Math.atan(x); return currentMode === 'DEG' ? r * 180 / Math.PI : r; },
        sqrt: Math.sqrt,
        pi: Math.PI,
        PI: Math.PI,
        e: Math.E,
        E: Math.E,
        abs: Math.abs,
        log: Math.log,
        ln: Math.log
      };

      const keys = Object.keys(context);
      const values = Object.values(context);
      
      // Use Function constructor to evaluate within context
      const fn = new Function(...keys, `return ${sanitized};`);
      const res = fn(...values);

      if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
        setPreview(res);
        return res;
      } else {
        setPreview('Error');
        return 'Error';
      }
    } catch (e) {
      setPreview('...');
      return '...';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExpression(e.target.value);
    evaluate(e.target.value, mode);
  };

  const handleInsert = (token: string, cursorOffset: number = 0) => {
    const input = inputRef.current;
    if (input) {
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const newExpr = expression.substring(0, start) + token + expression.substring(end);
        setExpression(newExpr);
        evaluate(newExpr, mode);
        
        // Restore focus and move cursor after the inserted token + offset
        setTimeout(() => {
            input.focus();
            const newCursorPos = start + token.length + cursorOffset;
            input.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
    } else {
        const newExpr = expression + token;
        setExpression(newExpr);
        evaluate(newExpr, mode);
    }
  };

  const handleModeToggle = () => {
    const newMode = mode === 'DEG' ? 'RAD' : 'DEG';
    setMode(newMode);
    evaluate(expression, newMode);
  };

  const handleApply = () => {
      const result = evaluate(expression, mode);
      if (typeof result === 'number') {
          let finalVal = result;
          // If in RAD mode, assume the user's result is in radians and convert to degrees
          // because the application always expects degrees for the fold angle.
          if (mode === 'RAD') {
            finalVal = result * (180 / Math.PI);
          }
          onApply(finalVal);
          onClose();
      }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`menu-panel bg-white rounded-xl shadow-2xl border border-gray-200 w-80 overflow-hidden animate-in zoom-in-95 duration-100 flex flex-col ${uiTheme === 'dark' ? 'ui-theme-dark' : ''}`} onMouseDown={e => e.stopPropagation()}>
        {/* Header */}
        <div className="menu-subtle bg-gray-50 p-3 flex justify-between items-center border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 text-gray-700 font-semibold text-sm">
            <Calculator size={16} className="text-blue-600" />
            <span>Calculator</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>

        {/* Display */}
        <div className="menu-surface p-4 bg-white shrink-0">
            <div className="relative">
                <input 
                    ref={inputRef}
                    value={expression}
                    onChange={handleChange}
                    onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                    className="w-full text-lg font-mono bg-gray-50 border border-gray-300 rounded p-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-800 placeholder-gray-300 pr-10"
                    placeholder="0"
                    autoFocus
                />
                <button 
                    className="absolute right-2 top-2.5 text-[10px] font-bold text-gray-500 hover:text-blue-600 bg-gray-200 hover:bg-blue-100 px-1.5 py-0.5 rounded cursor-pointer transition-colors select-none" 
                    onClick={handleModeToggle}
                    title="Toggle Degrees/Radians"
                >
                    {mode}
                </button>
            </div>
            <div className="mt-2 text-right h-6 text-gray-500 font-medium text-sm truncate">
                {typeof preview === 'number' ? `= ${parseFloat(preview.toFixed(8))}` : <span className="text-red-400">{preview}</span>}
            </div>
        </div>

        {/* Keypad */}
        <div className="menu-subtle bg-gray-50 p-2 grid grid-cols-4 gap-1">
            {/* Row 1 */}
            <Btn onClick={() => handleInsert('(')}>(</Btn>
            <Btn onClick={() => handleInsert(')')}>)</Btn>
            <Btn onClick={() => handleInsert('^')}>^</Btn>
            <Btn onClick={() => handleInsert('/')} accent>/</Btn>
            
            {/* Row 2 */}
            <Btn onClick={() => handleInsert('7')}>7</Btn>
            <Btn onClick={() => handleInsert('8')}>8</Btn>
            <Btn onClick={() => handleInsert('9')}>9</Btn>
            <Btn onClick={() => handleInsert('*')} accent>×</Btn>
            
            {/* Row 3 */}
            <Btn onClick={() => handleInsert('4')}>4</Btn>
            <Btn onClick={() => handleInsert('5')}>5</Btn>
            <Btn onClick={() => handleInsert('6')}>6</Btn>
            <Btn onClick={() => handleInsert('-')} accent>-</Btn>
            
            {/* Row 4 */}
            <Btn onClick={() => handleInsert('1')}>1</Btn>
            <Btn onClick={() => handleInsert('2')}>2</Btn>
            <Btn onClick={() => handleInsert('3')}>3</Btn>
            <Btn onClick={() => handleInsert('+')} accent>+</Btn>

            {/* Row 5 */}
            <Btn onClick={() => handleInsert('0')}>0</Btn>
            <Btn onClick={() => handleInsert('.')}>.</Btn>
            <Btn onClick={() => handleInsert('sqrt()', -1)}>√</Btn>
            <button onClick={handleApply} className="bg-blue-600 text-white rounded p-2 hover:bg-blue-700 active:scale-95 flex items-center justify-center transition-all shadow-sm">
                <Check size={20} />
            </button>
        </div>

        {/* Extended Functions */}
        <div className="menu-subtle bg-gray-100 p-2 grid grid-cols-4 gap-1 border-t border-gray-200 shrink-0">
            <SmallBtn onClick={() => handleInsert('sin()', -1)}>sin</SmallBtn>
            <SmallBtn onClick={() => handleInsert('cos()', -1)}>cos</SmallBtn>
            <SmallBtn onClick={() => handleInsert('tan()', -1)}>tan</SmallBtn>
            <SmallBtn onClick={() => handleInsert('pi')}>π</SmallBtn>
            
            <SmallBtn onClick={() => handleInsert('asin()', -1)}>asin</SmallBtn>
            <SmallBtn onClick={() => handleInsert('acos()', -1)}>acos</SmallBtn>
            <SmallBtn onClick={() => handleInsert('atan()', -1)}>atan</SmallBtn>
            <SmallBtn onClick={() => handleInsert('e')}>e</SmallBtn>
        </div>
      </div>
    </div>
  );
};

const Btn: React.FC<{ children: React.ReactNode, onClick: () => void, accent?: boolean }> = ({ children, onClick, accent }) => (
    <button onClick={onClick} className={`h-10 rounded font-medium text-lg transition-all active:scale-95 shadow-sm border border-gray-200/50 ${accent ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'menu-hover bg-white text-gray-700 hover:bg-gray-50'}`}>
        {children}
    </button>
);

const SmallBtn: React.FC<{ children: React.ReactNode, onClick: () => void }> = ({ children, onClick }) => (
    <button onClick={onClick} className="menu-hover h-8 rounded text-xs font-medium text-gray-600 bg-gray-200 hover:bg-gray-300 active:scale-95 transition-colors">
        {children}
    </button>
);
    
