import { Link } from '../app/Link';
import { PATHS } from '../app/router';
import { useT } from '../i18n';

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-gold-500/20 bg-night-950/80">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-night-400">
        <p>{t.footer.disclaimer}</p>
        <p>{t.footer.credits}</p>
        <p><Link to={PATHS.about} className="text-gold-400 hover:text-gold-200 hover:underline">{t.footer.about}</Link></p>
      </div>
    </footer>
  );
}
