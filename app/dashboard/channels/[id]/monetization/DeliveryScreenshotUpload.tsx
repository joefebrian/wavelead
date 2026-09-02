'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useUploadThing } from '@/lib/uploadthing';

export interface DeliveryAttachmentDraft {
  provider: 'uploadthing';
  storage_key: string;
  url: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  file_name_safe: string;
  size_bytes: number;
  uploaded_at: string;
}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export default function DeliveryScreenshotUpload({
  orderId,
  attachments,
  onChange,
  disabled,
}: {
  orderId: string;
  attachments: DeliveryAttachmentDraft[];
  onChange: (next: DeliveryAttachmentDraft[]) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const { startUpload, isUploading } = useUploadThing('deliveryScreenshots', {
    onClientUploadComplete: (results) => {
      const next: DeliveryAttachmentDraft[] = [...attachments];
      for (const r of results || []) {
        const sd = (r as unknown as { serverData?: DeliveryAttachmentDraft }).serverData;
        if (sd && sd.storage_key && sd.url) next.push({ ...sd });
      }
      onChange(next.slice(0, MAX_FILES));
      setError(null);
    },
    onUploadError: (e) => setError(e?.message || 'Upload failed'),
  });

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const raw = Array.from(e.target.files || []);
    e.target.value = '';   // reset input so same file can be re-selected
    if (raw.length === 0) return;
    if (attachments.length + raw.length > MAX_FILES) { setError(`Max ${MAX_FILES} screenshots per submission`); return; }
    const bad = raw.find((f) => !ALLOWED.includes(f.type));
    if (bad) { setError('Only JPEG, PNG, or WebP images allowed'); return; }
    const tooBig = raw.find((f) => f.size > MAX_BYTES);
    if (tooBig) { setError('Each image must be ≤ 5 MB'); return; }
    startUpload(raw, { orderId }).catch((err) => setError((err as Error).message));
  }

  function remove(idx: number) {
    if (isUploading) return;
    const next = [...attachments]; next.splice(idx, 1); onChange(next);
  }

  return (
    <div className="space-y-2" data-testid="delivery-screenshot-upload">
      <div className="flex items-center gap-2 flex-wrap">
        <label className={`inline-flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-secondary ${(disabled || isUploading || attachments.length >= MAX_FILES) ? 'opacity-50 pointer-events-none' : ''}`}>
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {isUploading ? 'Uploading…' : 'Upload Screenshot'}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={pickFiles} disabled={disabled || isUploading} />
        </label>
        {attachments.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" />{attachments.length} attached</span>
        )}
        <span className="text-xs text-muted-foreground">JPEG/PNG/WebP · up to 5 files · ≤ 5 MB each</span>
      </div>
      {error && <div className="inline-flex items-center gap-1 text-xs text-rose-600"><AlertTriangle className="h-3 w-3" />{error}</div>}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <div key={a.storage_key} className="relative group">
              <img src={a.url} alt={a.file_name_safe} className="h-20 w-20 object-cover rounded border border-border" />
              <button type="button" onClick={() => remove(i)} className="absolute -top-1 -right-1 rounded-full bg-background border border-border p-0.5 opacity-90 hover:opacity-100"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function isUploadingLocal(_x: unknown): boolean { return false; }
