import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { TextInput } from './PageShell';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  wrapperClassName?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className = '', wrapperClassName = '', ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`password-input-wrap ${wrapperClassName}`.trim()}>
      <TextInput
        ref={ref}
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`password-input-field ${className}`.trim()}
      />
      <button
        type="button"
        className="password-input-toggle"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((show) => !show)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        tabIndex={0}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
