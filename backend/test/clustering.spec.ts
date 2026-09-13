import { clusterSimilarity } from '../src/clustering/clustering.service';

describe('deterministic clustering', () => {
  it('clusters semantically overlapping event titles', () => {
    const score = clusterSimilarity(
      { title: 'Mochi the cat becomes viral after subway ride', url: 'https://a.example/story', keywords: ['mochi', 'cat', 'subway', 'viral'], entities: ['Mochi'] },
      { title: 'Viral cat Mochi spotted riding the subway', url: 'https://b.example/news', keywords: ['viral', 'cat', 'mochi', 'subway'], entities: ['Mochi'] },
    );
    expect(score).toBeGreaterThan(0.42);
  });
  it('keeps unrelated events apart', () => {
    const score = clusterSimilarity(
      { title: 'Cat rides subway', url: 'https://a.example/story', keywords: ['cat', 'subway'], entities: [] },
      { title: 'Central bank changes interest rate', url: 'https://finance.example/rates', keywords: ['bank', 'rates'], entities: [] },
    );
    expect(score).toBeLessThan(0.3);
  });
});
