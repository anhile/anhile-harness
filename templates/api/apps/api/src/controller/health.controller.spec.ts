import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('answers ok', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });

  it('answers a shape a caller can branch on, not a bare string', () => {
    // A client reading 'ok' cannot tell a healthy service from one that
    // echoes whatever it is asked. The key is what makes it checkable.
    expect(Object.keys(new HealthController().check())).toEqual(['status']);
  });
});
