import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';

export default function HomeSearchBar() {
  return (
    <Link
      to="/search"
      className="group flex w-full items-center gap-2.5 rounded-full glass-strong px-4 py-3 text-sm text-ink-mute transition duration-smooth ease-emphasized hover:-translate-y-0.5"
    >
      <Search size={16} className="shrink-0 text-ink-mute group-hover:text-accent transition-colors" />
      <span className="truncate">오늘은 어떤 음악이 필요하세요?</span>
    </Link>
  );
}
