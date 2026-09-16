import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cn } from '../../lib/cn';

/**
 * The one button. Four looks and three sizes, and nothing a page can pass
 * that is not one of them: a screen with a fifth kind of button is a screen
 * that has left the catalog, and DESIGN.md says why that is refused.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent/90',
        secondary: 'bg-surface text-fg border border-border hover:bg-border/40',
        ghost: 'text-fg hover:bg-border/40',
        danger: 'bg-danger text-accent-fg hover:bg-danger/90',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-11 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead of a `<button>`, keeping the look: a link that looks like a button. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps): ReactElement {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
