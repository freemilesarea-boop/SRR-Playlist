/**
 * KakaoChannelButtons — Phase X6.2
 *
 * "@듣다" 카카오톡 채널 친구추가 + 1:1 채팅 버튼.
 * Channel ID 미설정 시 silently 미렌더.
 *
 * @example
 *   <KakaoChannelButtons variant="row" /> // 친구추가 + 채팅 가로 정렬
 *   <KakaoChannelButtons variant="chat-only" /> // 채팅만
 *   <KakaoChannelButtons variant="add-only" /> // 친구추가만
 */
import { MessageCircle, UserPlus } from 'lucide-react';
import {
  isKakaoChannelConfigured,
  addKakaoChannel,
  openKakaoChannelChat,
} from '@/lib/kakao';

interface Props {
  variant?: 'row' | 'chat-only' | 'add-only' | 'stacked';
  size?: 'sm' | 'md';
  /** 채팅 버튼 라벨 커스터마이즈 */
  chatLabel?: string;
  /** 친구추가 버튼 라벨 커스터마이즈 */
  addLabel?: string;
  className?: string;
}

export default function KakaoChannelButtons({
  variant = 'row',
  size = 'md',
  chatLabel = '카톡으로 문의하기',
  addLabel = '채널 친구추가',
  className = '',
}: Props) {
  if (!isKakaoChannelConfigured()) return null;

  const sizeClass = size === 'sm'
    ? 'px-2.5 py-1.5 text-[11px]'
    : 'px-3.5 py-2 text-xs';
  const iconSize = size === 'sm' ? 12 : 14;

  const ChatBtn = (
    <button
      onClick={() => void openKakaoChannelChat()}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#FEE500] font-semibold text-[#191919] hover:bg-[#FDD800] ${sizeClass}`}
    >
      <MessageCircle size={iconSize} /> {chatLabel}
    </button>
  );

  const AddBtn = (
    <button
      onClick={() => void addKakaoChannel()}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-bg-card font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover hover:text-ink ${sizeClass}`}
    >
      <UserPlus size={iconSize} /> {addLabel}
    </button>
  );

  switch (variant) {
    case 'chat-only': return <div className={className}>{ChatBtn}</div>;
    case 'add-only': return <div className={className}>{AddBtn}</div>;
    case 'stacked':
      return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
          {ChatBtn}
          {AddBtn}
        </div>
      );
    case 'row':
    default:
      return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
          {ChatBtn}
          {AddBtn}
        </div>
      );
  }
}
