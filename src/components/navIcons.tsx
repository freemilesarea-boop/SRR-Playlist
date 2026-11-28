/**
 * navIcons.tsx — appNav 의 아이콘 키 → 실제 아이콘 컴포넌트.
 *
 * appNav.ts 는 DOM/아이콘 의존 없이 테스트할 수 있어야 해서 키만 넘긴다.
 * 그 키를 실제 아이콘으로 바꾸는 곳은 여기 한 군데뿐이다.
 */
import {
  Home, Search, BarChart3, Heart, ListMusic, CreditCard, Receipt, Store, Tag,
  User, Wand2, Shield, Mic2, Briefcase, Building2, LifeBuoy, Megaphone,
  FileText, Menu, type LucideIcon,
} from 'lucide-react';
import type { NavIconKey } from '@/lib/appNav';

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  home: Home,
  search: Search,
  chart: BarChart3,
  library: Heart,
  playlists: ListMusic,
  pricing: CreditCard,
  subscription: Receipt,
  store: Store,
  brand: Tag,
  profile: User,
  studio: Wand2,
  admin: Shield,
  artist: Mic2,
  sales: Briefcase,
  hq: Building2,
  support: LifeBuoy,
  notice: Megaphone,
  legal: FileText,
  more: Menu,
};
