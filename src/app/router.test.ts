import { describe, expect, it } from 'vitest';
import { PATHS, pageFor } from './router';

describe('pageFor', () => {
  it('maps the known paths', () => {
    expect(pageFor('/')).toBe('landing');
    expect(pageFor('/app')).toBe('app');
    expect(pageFor('/app/')).toBe('app');
    expect(pageFor('/app/solver')).toBe('app');
    expect(pageFor('/about')).toBe('about');
    expect(pageFor('/about/')).toBe('about');
    expect(pageFor('/About')).toBe('about');
  });

  it('sends unknown paths to the landing page', () => {
    expect(pageFor('')).toBe('landing');
    expect(pageFor('/nope')).toBe('landing');
    expect(pageFor('/application')).toBe('landing');
    expect(pageFor('/about/more')).toBe('landing');
    expect(pageFor('/index.html')).toBe('landing');
  });

  it('round-trips every page path', () => {
    for (const [page, path] of Object.entries(PATHS)) expect(pageFor(path)).toBe(page);
  });
});
