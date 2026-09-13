import { describe, expect, it } from "vitest";
import { getSimulatorDefaults } from "./simulator-config";

describe("runtime simulator defaults", () => {
  it("prefers server settings and supports existing environment names", () => {
    expect(
      getSimulatorDefaults({
        SIMULATOR_CURRENT_AGE: "40",
        NEXT_PUBLIC_SIMULATOR_CURRENT_AGE: "30",
        NEXT_PUBLIC_SIMULATOR_MONTHLY_CONTRIBUTION: "100",
        SIMULATOR_WITHDRAWAL_MODE: "rate",
      }),
    ).toMatchObject({
      defaultCurrentAge: 40,
      defaultMonthlyContribution: 100,
      defaultWithdrawalMode: "rate",
    });
  });
  it("does not return invalid or non-finite settings", () => {
    expect(
      getSimulatorDefaults({
        SIMULATOR_CURRENT_AGE: " ",
        SIMULATOR_MONTHLY_CONTRIBUTION: "NaN",
        SIMULATOR_VOLATILITY: "Infinity",
        SIMULATOR_WITHDRAWAL_MODE: "unknown",
      }),
    ).toMatchObject({
      defaultCurrentAge: undefined,
      defaultMonthlyContribution: undefined,
      defaultVolatility: undefined,
      defaultWithdrawalMode: undefined,
    });
  });
  it("reads each call independently and keeps portfolio-derived initial capital", () => {
    const env = { SIMULATOR_CURRENT_AGE: "30", SIMULATOR_INITIAL_AMOUNT: "999" };
    expect(getSimulatorDefaults(env).defaultCurrentAge).toBe(30);
    env.SIMULATOR_CURRENT_AGE = "31";
    expect(getSimulatorDefaults(env).defaultCurrentAge).toBe(31);
    expect(getSimulatorDefaults(env)).not.toHaveProperty("defaultInitialAmount");
  });
});
