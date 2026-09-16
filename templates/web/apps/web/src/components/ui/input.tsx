import type { InputHTMLAttributes, ReactElement } from 'react';
import { cn } from '../../lib/cn';

/** A text field. The label is a separate element, always present: see Label. */
export function Input({ className, type = 'text', ...props }: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
