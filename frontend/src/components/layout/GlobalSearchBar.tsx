import { Search, Settings } from 'lucide-react';

type GlobalSearchBarProps = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

export function GlobalSearchBar({ placeholder, value, onChange }: GlobalSearchBarProps) {
  return (
    <div className="search-card">
      <Search size={16} />
      <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      <Settings size={16} />
    </div>
  );
}
