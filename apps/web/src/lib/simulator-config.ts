// Read on the server at request time; never embed personal defaults in client bundles.
export function getSimulatorDefaults(
  environment: Record<string, string | undefined> = process.env,
) {
  const read = (name: string) =>
    environment[`SIMULATOR_${name}`] ?? environment[`NEXT_PUBLIC_SIMULATOR_${name}`];
  const number = (name: string): number | undefined => {
    const value = read(name);
    if (!value?.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const value = read("WITHDRAWAL_MODE");
  const mode: "rate" | "amount" | undefined =
    value === "rate" || value === "amount" ? value : undefined;
  return {
    defaultCurrentAge: number("CURRENT_AGE"),
    defaultMonthlyContribution: number("MONTHLY_CONTRIBUTION"),
    defaultAnnualReturnRate: number("ANNUAL_RETURN_RATE"),
    defaultInflationRate: number("INFLATION_RATE"),
    defaultContributionYears: number("CONTRIBUTION_YEARS"),
    defaultWithdrawalStartYear: number("WITHDRAWAL_START_YEAR"),
    defaultWithdrawalYears: number("WITHDRAWAL_YEARS"),
    defaultWithdrawalRate: number("WITHDRAWAL_RATE"),
    defaultMonthlyWithdrawal: number("MONTHLY_WITHDRAWAL"),
    defaultExpenseRatio: number("EXPENSE_RATIO"),
    defaultVolatility: number("VOLATILITY"),
    defaultBasePension: number("BASE_PENSION"),
    defaultPensionStartAge: number("PENSION_START_AGE"),
    defaultMonthlyOtherIncome: number("MONTHLY_OTHER_INCOME"),
    defaultWithdrawalMode: mode,
  };
}
