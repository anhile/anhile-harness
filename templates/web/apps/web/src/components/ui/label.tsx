import type { LabelHTMLAttributes, ReactElement } from 'react';
import { cn } from '../../lib/cn';

/** The name of a field, tied to it by `htmlFor`. A placeholder is not a label. */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>): ReactElement {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}
