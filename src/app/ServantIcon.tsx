/** Servant/CE face from the Atlas CDN (never re-hosted), lazy loaded. */
export function FaceIcon({ face, name, size = 40, className = '' }: {
  face: string | undefined; name: string; size?: number; className?: string;
}) {
  const style = { width: size, height: size };
  if (!face) {
    return (
      <span role="img" aria-label={name} style={style}
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-zinc-700 text-xs font-semibold text-zinc-300 ${className}`}>
        {name.slice(0, 2)}
      </span>
    );
  }
  return <img src={face} alt={name} title={name} loading="lazy" decoding="async" width={size} height={size} style={style}
    className={`shrink-0 rounded-md bg-zinc-800 object-cover ${className}`} />;
}
