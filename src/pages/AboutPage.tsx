import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n';

const FGA = import.meta.env.VITE_ENABLE_FGA !== 'false';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3">
      <h2 className="text-xl font-semibold text-sky-300">
        <a href={`#${id}`} className="hover:underline">{title}</a>
      </h2>
      {children}
    </section>
  );
}

const H3 = ({ children }: { children: ReactNode }) => <h3 className="pt-2 font-semibold text-zinc-100">{children}</h3>;

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`space-y-1.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
      {items.map((s) => <li key={s}>{s}</li>)}
    </Tag>
  );
}

export function AboutPage() {
  const t = useT();
  const a = t.about;
  const { use, calc, limits, faq, credits } = a;

  // The content renders after load, so the browser does not jump to a #hash by itself.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const toc: [string, string][] = [
    ['what', a.what.heading], ['use', use.heading], ['calc', calc.heading],
    ['limits', limits.heading], ['faq', faq.heading], ['credits', credits.heading],
  ];
  const qa: [string, string][] = [[faq.q1, faq.a1], [faq.q2, faq.a2], [faq.q3, faq.a3]];
  if (FGA) qa.push([faq.q4, faq.a4]);

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-10 text-zinc-300">
      <header className="space-y-4">
        <h1 className="text-3xl font-bold text-sky-400">{a.title}</h1>
        <nav aria-label={a.toc} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="mb-2 text-sm font-semibold text-zinc-400">{a.toc}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {toc.map(([id, title]) => <li key={id}><a href={`#${id}`} className="text-sky-400 hover:underline">{title}</a></li>)}
          </ol>
        </nav>
      </header>

      <Section id="what" title={a.what.heading}>
        <p>{a.what.p1}</p>
        <p>{a.what.p2}</p>
      </Section>

      <Section id="use" title={use.heading}>
        <H3>{use.rosterHeading}</H3>
        <p>{use.rosterP}</p>
        <List items={[use.rosterManual, use.rosterCatalog, use.rosterChaldea]} />
        <H3>{use.chaldeaHeading}</H3>
        <List ordered items={[use.chaldeaStep1, use.chaldeaStep2, use.chaldeaStep3]} />
        <p className="text-sm text-amber-300">{use.chaldeaNote}</p>
        <H3>{use.nodeHeading}</H3>
        <p>{use.nodeP}</p>
        <H3>{use.teamHeading}</H3>
        <p>{use.teamP1}</p>
        <p>{use.teamP2}</p>
        <p>{use.teamP3}</p>
        <H3>{use.resultsHeading}</H3>
        <p>{use.resultsP1}</p>
        <p>{use.resultsP2}</p>
        <p>{use.resultsP3}</p>
      </Section>

      <Section id="calc" title={calc.heading}>
        <p>{calc.intro}</p>
        <List items={[calc.minRoll, calc.refund, calc.overcharge, calc.bonuses, calc.reinforcements, calc.target, calc.enemies, calc.replay]} />
      </Section>

      <Section id="limits" title={limits.heading}>
        <p>{limits.intro}</p>
        <List items={[limits.npOnly, limits.unsupported, limits.any, limits.support, limits.nodes]} />
      </Section>

      <Section id="faq" title={faq.heading}>
        <dl className="space-y-4">
          {qa.map(([q, ans]) => (
            <div key={q}>
              <dt className="font-semibold text-zinc-100">{q}</dt>
              <dd className="mt-1">{ans}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="credits" title={credits.heading}>
        <List items={[credits.atlas, credits.chaldea, credits.affiliation, credits.ownership, credits.money]} />
      </Section>
    </div>
  );
}
