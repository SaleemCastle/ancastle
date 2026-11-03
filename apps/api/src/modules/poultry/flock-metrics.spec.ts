import { Prisma } from '../../generated/prisma/client.js';
import { calculateFlockMetrics } from './flock-metrics.js';

describe('Deterministic flock metrics', () => {
  const flock = {
    startingBirdCount: 3,
    placementDate: '2028-02-28',
    expectedMaturityDate: '2028-03-06',
  };
  const mortality = (value: string) => new Prisma.Decimal(value);

  it('defines placement-day and zero-mortality behavior without a clock', () => {
    const metrics = calculateFlockMetrics(
      flock,
      mortality('0'),
      [],
      '2028-02-28',
    );
    expect(metrics).toMatchObject({
      cumulativeMortality: 0,
      liveBirdCount: 3,
      ageDays: 0,
      ageWeeks: 0,
      daysToMaturity: 7,
      maturityState: 'BEFORE_EXPECTED_MATURITY',
      cumulativeFeedUsage: [],
    });
    expect(metrics.mortalityPercentage.toString()).toBe('0');
  });

  it('calculates percentage in Decimal with defined rounding and allows exactly zero live birds', () => {
    const partial = calculateFlockMetrics(
      flock,
      mortality('1'),
      [],
      '2028-03-01',
    );
    expect(partial.liveBirdCount).toBe(2);
    expect(partial.mortalityPercentage.toString()).toBe('33.333333');
    const complete = calculateFlockMetrics(
      flock,
      mortality('3'),
      [],
      '2028-03-01',
    );
    expect(complete.liveBirdCount).toBe(0);
    expect(complete.mortalityPercentage.toString()).toBe('100');
    // No global Decimal settings may be changed by metric calculation.
    expect(Prisma.Decimal.precision).toBe(20);
  });

  it('uses completed calendar days/weeks across leap days and DST boundaries', () => {
    expect(
      calculateFlockMetrics(flock, mortality('0'), [], '2028-03-05'),
    ).toMatchObject({ ageDays: 6, ageWeeks: 0 });
    expect(
      calculateFlockMetrics(flock, mortality('0'), [], '2028-03-06'),
    ).toMatchObject({ ageDays: 7, ageWeeks: 1 });
    expect(
      calculateFlockMetrics(
        { ...flock, placementDate: '2028-03-11', expectedMaturityDate: null },
        mortality('0'),
        [],
        '2028-03-13',
      ),
    ).toMatchObject({ ageDays: 2, ageWeeks: 0 });
  });

  it('distinguishes before maturity, at/past maturity and absence of a maturity date', () => {
    expect(
      calculateFlockMetrics(flock, mortality('0'), [], '2028-03-05'),
    ).toMatchObject({
      daysToMaturity: 1,
      maturityState: 'BEFORE_EXPECTED_MATURITY',
    });
    for (const date of ['2028-03-06', '2028-03-07']) {
      expect(
        calculateFlockMetrics(flock, mortality('0'), [], date),
      ).toMatchObject({
        daysToMaturity: 0,
        maturityState: 'AT_OR_PAST_EXPECTED_MATURITY',
      });
    }
    expect(
      calculateFlockMetrics(
        { ...flock, expectedMaturityDate: null },
        mortality('0'),
        [],
        '2028-03-06',
      ),
    ).toMatchObject({
      daysToMaturity: null,
      maturityState: 'NO_EXPECTED_MATURITY_DATE',
    });
  });

  it('rejects pre-placement/invalid calendar input instead of producing negative or timezone-dependent age', () => {
    for (const date of ['2028-02-27', '2027-02-29', '2028-03-01T00:00:00Z']) {
      expect(() =>
        calculateFlockMetrics(flock, mortality('0'), [], date),
      ).toThrow(expect.objectContaining({ code: 'FLOCK_INVALID_AS_OF_DATE' }));
    }
  });

  it('fails safely on an invalid denominator or inconsistent population history', () => {
    expect(() =>
      calculateFlockMetrics(
        { ...flock, startingBirdCount: 0 },
        mortality('0'),
        [],
        '2028-03-01',
      ),
    ).toThrow(expect.objectContaining({ code: 'FLOCK_HISTORY_INVALID' }));
    for (const value of ['-1', '4', '1.5']) {
      expect(() =>
        calculateFlockMetrics(flock, mortality(value), [], '2028-03-01'),
      ).toThrow(expect.objectContaining({ code: 'FLOCK_HISTORY_INVALID' }));
    }
  });
});
