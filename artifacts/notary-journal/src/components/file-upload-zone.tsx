import * as React from 'react';
import { Upload, X, Camera, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FileUploadZoneProps {
  /** Label shown above the upload zone */
  label: string;
  /** Helper text shown below the label */
  description?: string;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Accepted file types (default: image/*) */
  accept?: string;
  /** Enable camera capture on mobile */
  capture?: 'user' | 'environment';
  /** Currently selected files */
  files: File[];
  /** Callback when files change */
  onFilesChange: (files: File[]) => void;
  /** Error message to display */
  error?: string;
  /** Disable the upload zone */
  disabled?: boolean;
  className?: string;
}

/**
 * Reusable drag-and-drop file upload zone.
 * Supports multiple files, image previews, remove individual files,
 * and camera capture on mobile devices.
 */
export function FileUploadZone({
  label,
  description,
  maxFiles = 3,
  accept = 'image/*',
  capture,
  files,
  onFilesChange,
  error,
  disabled = false,
  className,
}: FileUploadZoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const remaining = maxFiles - files.length;

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles || disabled) return;
    const arr = Array.from(newFiles);
    const combined = [...files, ...arr].slice(0, maxFiles);
    onFilesChange(combined);
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const previewUrls = React.useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files]
  );

  React.useEffect(() => {
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [previewUrls]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">{label}</label>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {remaining > 0 && !disabled && (
          <span className="text-xs text-muted-foreground">
            {remaining} more
          </span>
        )}
      </div>

      {/* Previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <div key={i} className="relative group">
              <div className="w-20 h-20 rounded-lg border overflow-hidden bg-muted">
                {file.type.startsWith('image/') ? (
                  <img
                    src={previewUrls[i]}
                    alt={`Preview ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={disabled}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3 h-3" />
              </button>
              <p className="text-[10px] text-muted-foreground truncate w-20 mt-1">
                {file.name}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {remaining > 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/50',
            disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
          )}
          role="button"
          tabIndex={0}
          aria-label={label}
        >
          <Upload className="w-8 h-8 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">
              Tap to upload or drag & drop
            </p>
            <p className="text-xs text-muted-foreground">
              Up to {maxFiles} files · Images recommended
            </p>
          </div>
          {capture && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              <Camera className="w-4 h-4" />
              Open Camera
            </Button>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture}
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
        disabled={disabled}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
