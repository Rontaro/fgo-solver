import { Link } from '../app/Link';
import { PATHS } from '../app/router';
import { useT } from '../i18n';

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/50">
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-zinc-500">
        <p>{t.footer.disclaimer}</p>
        <p>{t.footer.credits}</p>
        <p><Link to={PATHS.about} className="text-sky-400 hover:underline">{t.footer.about}</Link></p>
      </div>
    </footer>
  );
}
