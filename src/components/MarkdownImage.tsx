import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { FileAccess, OpenedDocument } from '../platform/files';

interface Props {
  doc: OpenedDocument;
  files: FileAccess;
  src: string;
  alt?: string;
}

/** An image (figure + caption), or the handoff's dashed placeholder with its file name when it cannot load. */
export function MarkdownImage({ doc, files, src, alt }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setUrl(null);
    setFailed(false);
    files.loadImage(doc, src).then(
      (loaded) => {
        if (cancelled) {
          if (loaded?.startsWith('blob:')) URL.revokeObjectURL(loaded);
          return;
        }
        created = loaded;
        if (loaded === null) setFailed(true);
        else setUrl(loaded);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (created?.startsWith('blob:')) URL.revokeObjectURL(created);
    };
  }, [doc, files, src]);

  const fileName = decodeURIComponent(src.split(/[?#]/)[0].split(/[\\/]/).pop() ?? src) || src;

  return (
    <span className="gonq-figure">
      {failed ? (
        <span className="gonq-figure-placeholder" data-testid="figure-placeholder">
          <ImageOff size={32} strokeWidth={1.4} aria-hidden="true" />
          <span>{fileName}</span>
        </span>
      ) : (
        url && <img src={url} alt={alt ?? ''} onError={() => setFailed(true)} />
      )}
      {alt ? <span className="gonq-figure-caption">{alt}</span> : null}
    </span>
  );
}
