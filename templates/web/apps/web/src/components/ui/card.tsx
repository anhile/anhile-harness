import type { HTMLAttributes, ReactElement } from 'react';
import { cn } from '../../lib/cn';

/** A bounded surface: one thing, with a title, on the page's background. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn('rounded-lg border border-border bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): ReactElement {
  return <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): ReactElement {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn('flex items-center gap-2 p-6 pt-0', className)} {...props} />;
}
