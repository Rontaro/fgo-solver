import { Link } from '../app/Link';
import { useRegionData } from '../app/RegionData';
import { PATHS } from '../app/router';
import { FaceIcon } from '../app/ServantIcon';
import type { CompactServant } from '../data/types';
import { useT } from '../i18n';

/** Collection numbers of servants common in farming teams; shown only once the data is loaded and has them. */
const POPULAR = [284, 314, 316, 215, 150, 37, 16, 163];

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
    <div className="mx-auto max-w-6xl space-y-14 px-4 py-12">
      <section className="space-y-5 text-center">
        <h1 className="text-4xl font-bold text-sky-400 sm:text-5xl">{l.title}</h1>
        <p className="mx-auto max-w-2xl text-lg text-zinc-300">{l.pitch}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to={PATHS.app} className="rounded bg-sky-600 px-5 py-2.5 font-semibold text-white hover:bg-sky-500">{l.cta}</Link>
          <Link to={PATHS.about} className="rounded border border-zinc-700 px-5 py-2.5 text-zinc-200 hover:border-zinc-500">{l.docs}</Link>
        </div>
        {faces.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 pt-2" role="group" aria-label={l.facesLabel}>
            {faces.map((s) => <FaceIcon key={s.collectionNo} face={s.face} name={s.name} size={48} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="features">
        <h2 id="features" className="sr-only">{l.featuresHeading}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(([title, body]) => (
            <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h3 className="mb-2 font-semibold text-sky-300">{title}</h3>
              <p className="text-sm text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="space-y-4">
        <h2 id="how" className="text-xl font-semibold text-zinc-100">{l.howHeading}</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 font-bold text-white">{i + 1}</span>
              <div>
                <h3 className="font-semibold text-zinc-100">{title}</h3>
                <p className="text-sm text-zinc-400">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
