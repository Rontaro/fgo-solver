/** Servant/CE face from the Atlas CDN (never re-hosted), lazy loaded. */
/** eager: load at once (above-the-fold icons); the default lazy loading suits long lists. */
export function FaceIcon({ face, name, size = 40, className = '', eager = false }: {
  face: string | undefined; name: string; size?: number; className?: string; eager?: boolean;
}) {
  const style = { width: size, height: size };
  if (!face) {
    return (
      <span role="img" aria-label={name} style={style}
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-night-700 text-xs font-semibold text-night-300 ${className}`}>
        {name.slice(0, 2)}
      </span>
    );
  }
  return <img src={face} alt={name} title={name} loading={eager ? 'eager' : 'lazy'} decoding="async" width={size} height={size} style={style}
    className={`shrink-0 rounded-md bg-night-800 object-cover ${className}`} />;
}
