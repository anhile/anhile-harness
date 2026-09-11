import { greet } from './index.js';

describe('greet', () => {
  it('greets by name', () => {
    expect(greet('world')).toBe('Hello, world.');
  });

  it('refuses an empty name rather than greeting nobody', () => {
    expect(() => greet('   ')).toThrow(/needs a name/u);
  });
});
