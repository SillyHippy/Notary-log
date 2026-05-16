import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ExpandableImageProps = {
  src: string;
  alt: string;
  label?: string;
  className?: string;
};

/** Thumbnail that opens a full-size preview in a dialog (journal entry detail pattern). */
export function ExpandableImage({ src, alt, label, className }: ExpandableImageProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            className ??
            'relative w-24 h-16 rounded overflow-hidden border border-border hover:ring-2 ring-primary transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          }
          aria-label={`View ${alt}`}
        >
          <img src={src} alt={alt} className="object-cover w-full h-full" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label ?? alt}</DialogTitle>
        </DialogHeader>
        <img src={src} alt={alt} className="w-full h-auto rounded" />
      </DialogContent>
    </Dialog>
  );
}
