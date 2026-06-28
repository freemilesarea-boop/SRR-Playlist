/**
 * AdminButton — variant: solid/subtle/ghost/outline × 6 tones, size: sm/md/lg.
 *
 * 예:
 *   <AdminButton tone="primary" leftIcon={<Plus size={14} />}>본사 추가</AdminButton>
 *   <AdminButton tone="danger" variant="subtle" size="sm">삭제</AdminButton>
 */
import { adminPalette, adminTokens, type AdminToneName } from './palette';

type AdminButtonVariant = 'solid' | 'subtle' | 'ghost' | 'outline';
type AdminButtonSize = 'sm' | 'md' | 'lg';

interface AdminButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: AdminToneName;
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const SIZE_CLS: Record<AdminButtonSize, string> = {
  sm: 'px-2 py-1 text-[11px] gap-1',
  md: 'px-3 py-1.5 text-xs gap-1.5',
  lg: 'px-4 py-2.5 text-sm gap-2',
};

export function AdminButton({
  tone = 'primary',
  variant = 'solid',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...rest
}: AdminButtonProps) {
  const palette = adminPalette[tone];
  const variant_cls =
    variant === 'solid'   ? palette.buttonSolid
    : variant === 'subtle' ? palette.buttonSubtle
    : variant === 'ghost'  ? palette.buttonGhost
    :                        palette.buttonOutline;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold ${adminTokens.radius.md} ${SIZE_CLS[size]} ${variant_cls} ${adminTokens.transition} ${adminTokens.focusRing} disabled:opacity-40 disabled:cursor-not-allowed ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {leftIcon}
      {loading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
      {rightIcon}
    </button>
  );
}
