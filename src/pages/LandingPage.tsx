import { Link } from '../app/Link';
import { useRegionData } from '../app/RegionData';
import { PATHS } from '../app/router';
import { FaceIcon } from '../app/ServantIcon';
import type { CompactServant } from '../data/types';
import { useT } from '../i18n';

/** Collection numbers of servants common in farming teams; shown only once the data is loaded and has them. */
const POPULAR = [284, 314, 316, 215, 150, 37, 16, 163];

// Accent per feature card (command card colours, then gold).
const ACCENTS = ['bg-buster', 'bg-arts', 'bg-quick', 'bg-gold-500'];
const GLOWS = ['shadow-[0_0_12px_#ff5a5a]', 'shadow-[0_0_12px_#4f8cff]', 'shadow-[0_0_12px_#3fd17a]', 'shadow-[0_0_12px_#d9b86c]'];
const NUMERALS = ['I', 'II', 'III', 'IV'];

export function LandingPage() {
  const t = useT();
  const l = t.landing;
  const { data } = useRegionData();
  const faces = data
    ? POPULAR.map((no) => data.servants.get(no)).filter((s): s is CompactServant => !!s?.face)
    : [];
  const features = [
    [l.findTitle, l.findBody], [l.safeTitle, l.safeBody], [l.chaldeaTitle, l.chaldeaBody], [l.localTitle, l.localBody],
  ];
  const steps = [
    [l.step1Title, l.step1Body], [l.step2Title, l.step2Body], [l.step3Title, l.step3Body], [l.step4Title, l.step4Body],
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-16 px-4 pb-16 pt-16 sm:pt-20">
      <section className="flex flex-col items-center gap-6 text-center">
        <p className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-gold-500">
          <span className="h-px w-12 bg-gradient-to-r from-transparent to-gold-500" aria-hidden="true" />
          {l.eyebrow}
          <span className="h-px w-12 bg-gradient-to-r from-gold-500 to-transparent" aria-hidden="true" />
        </p>
        <h1 className="font-display text-5xl font-bold tracking-wide text-gold-400 [text-shadow:0_0_32px_rgba(217,184,108,0.25)] sm:text-7xl">{l.title}</h1>
        <p className="max-w-2xl text-lg text-night-200">{l.pitch}</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link to={PATHS.app} className="btn-primary min-h-12 px-7">
            {l.cta}
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link to={PATHS.about} className="btn-ghost min-h-12 px-6">{l.docs}</Link>
        </div>
        {faces.length > 0 && (
          <div className="flex flex-wrap justify-center gap-3.5 pt-6" role="group" aria-label={l.facesLabel}>
            {faces.map((s) => (
              <FaceIcon key={s.collectionNo} face={s.face} name={s.name} size={60} eager
                className="!rounded-xl border border-gold-500 shadow-[0_0_0_3px_#0a0f24,0_0_0_4px_rgba(217,184,108,0.35),0_6px_22px_rgba(79,140,255,0.25)]" />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="features" className="space-y-7">
        <h2 id="features" className="rule-heading">{l.featuresHeading}</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(([title, body], i) => (
            <article key={title} className="relative rounded-xl border border-gold-500/30 bg-gradient-to-b from-night-800/80 to-night-900 p-6">
              <span className={`absolute inset-x-6 -top-px h-0.5 rounded bg-gradient-to-r from-transparent via-current to-transparent ${ACCENTS[i].replace('bg-', 'text-')}`} aria-hidden="true" />
              <div className="mb-2.5 flex items-center gap-3">
                <span className={`h-2.5 w-2.5 shrink-0 rotate-45 ${ACCENTS[i]} ${GLOWS[i]}`} aria-hidden="true" />
                <h3 className="font-display text-lg font-semibold tracking-wide text-night-50">{title}</h3>
              </div>
              <p className="text-sm text-night-300">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="space-y-7">
        <h2 id="how" className="rule-heading">{l.howHeading}</h2>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex gap-4 rounded-xl border border-gold-500/20 bg-night-900/60 p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold-500 font-display text-base font-bold text-gold-300 shadow-[0_0_18px_rgba(217,184,108,0.25)]" aria-hidden="true">{NUMERALS[i]}</span>
              <div>
                <h3 className="mb-1 font-semibold text-night-50"><span className="sr-only">{i + 1}. </span>{title}</h3>
                <p className="text-sm text-night-300">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
