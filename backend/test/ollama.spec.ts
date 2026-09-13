import { parseOllamaJson } from '../src/ai/ollama.service';

describe('Ollama structured output', () => {
  it('parses fenced JSON and validates every field', () => {
    const parsed = parseOllamaJson('```json\n{"headline":"A real headline","summary":"A sufficiently detailed factual summary.","whyTrending":"Multiple independent sources are accelerating.","category":"MEMES","entities":["Example"],"confidence":0.8,"isNewsworthy":true,"isMeme":true,"isDrama":false,"isPolitical":false,"isCrypto":false}\n```');
    expect(parsed.isNewsworthy).toBe(true);
  });
  it('rejects incomplete output', () => expect(() => parseOllamaJson('{"headline":"Only title"}')).toThrow());
});
