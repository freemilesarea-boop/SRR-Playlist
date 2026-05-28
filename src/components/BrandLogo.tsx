import { useBrandStore } from '@/store/brandStore';
import { LogoMark } from '@/components/Logo';

interface Props {
  size?: number;
  className?: string;
  /** SVG 폴백 색상 (text-* utility). 업로드된 이미지에는 영향 없음. */
  fallbackColorClass?: string;
}

/**
 * 운영자가 업로드한 로고 이미지를 우선 노출. 업로드 전(또는 fetch 실패) 에는 LogoMark SVG 폴백.
 * 부모는 명시적 size 제공 권장. 이미지 비율은 object-contain 으로 보존.
 */
export default function BrandLogo({ size = 32, className = '', fallbackColorClass = '' }: Props) {
  const logoUrl = useBrandStore((s) => s.logo_url);
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="DEUDDA"
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
        // 이미지 로드 실패 시 자식 SVG 폴백을 보여주려면 onError 에서 store 를 null 로 set 할 수도.
        // 여기서는 단순화 — broken image 표시 (이슈 시 운영자가 즉시 인지 가능).
      />
    );
  }
  return <LogoMark size={size} className={`${fallbackColorClass} ${className}`} />;
}
