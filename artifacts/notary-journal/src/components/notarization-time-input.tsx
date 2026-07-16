import { buildTime12Hour, splitTime12Hour } from '@/lib/journal-datetime';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type NotarizationTimeInputProps = {
  value: string;
  onChange: (value: string) => void;
  'data-testid'?: string;
};

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export function NotarizationTimeInput({ value, onChange, 'data-testid': testId }: NotarizationTimeInputProps) {
  const { hour, minute, period } = splitTime12Hour(value);

  const update = (h: number, m: number, p: 'AM' | 'PM') => {
    onChange(buildTime12Hour(h, m, p));
  };

  return (
    <div className="flex gap-2" data-testid={testId}>
      <Select
        value={String(hour)}
        onValueChange={v => update(parseInt(v, 10), minute, period)}
      >
        <SelectTrigger className="flex-1" aria-label="Hour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map(h => (
            <SelectItem key={h} value={String(h)}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(minute)}
        onValueChange={v => update(hour, parseInt(v, 10), period)}
      >
        <SelectTrigger className="flex-1" aria-label="Minute">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-48">
          {MINUTES.map(m => (
            <SelectItem key={m} value={String(m)}>
              {String(m).padStart(2, '0')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={period}
        onValueChange={v => update(hour, minute, v as 'AM' | 'PM')}
      >
        <SelectTrigger className="w-20" aria-label="AM or PM">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
