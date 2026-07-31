import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-gold text-ink hover:bg-gold-deep active:bg-gold-deep disabled:bg-gold-soft disabled:text-ink-soft',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-ink hover:bg-paper disabled:text-ink-soft disabled:border-line',
  ghost: 'bg-transparent text-ink hover:bg-paper disabled:text-ink-soft',
  danger: 'bg-status-lost text-white hover:brightness-110 disabled:opacity-50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center rounded-control font-medium transition-colors',
    'disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading ? <Spinner size={16} tone={variant === 'primary' ? 'ink' : 'gold'} /> : null}
      {children}
    </button>
  );
});

interface ButtonLinkProps
  extends LinkProps, Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'target'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Same visual language as Button, for navigation that should look like an action. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = 'primary', size = 'md', className, children, ...props },
  ref,
) {
  return (
    <Link ref={ref} className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </Link>
  );
});
