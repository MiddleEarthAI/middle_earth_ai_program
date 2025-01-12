import { assert } from 'chai';

//
// Simplified Agent class to simulate cooldown behavior.
//
class Agent {
  // Timestamps (in seconds) of the last performed actions.
  public lastIgnore: number;
  public lastAttack: number;

  // Cooldown durations (in seconds)
  static readonly IGNORE_COOLDOWN = 3600; // e.g., 1 hour cooldown
  static readonly ATTACK_COOLDOWN = 3600; // e.g., 1 hour cooldown

  constructor() {
    this.lastIgnore = 0;
    this.lastAttack = 0;
  }

  /**
   * Simulates an "ignore" action.
   * Returns true if the action is allowed (i.e. cooldown has expired), false otherwise.
   */
  ignore(now: number): boolean {
    if (now < this.lastIgnore + Agent.IGNORE_COOLDOWN) {
      return false;
    }
    // Update the cooldown timestamp.
    this.lastIgnore = now;
    return true;
  }

  /**
   * Simulates a battle attack resolution.
   * Returns true if the attack is allowed (i.e. cooldown has expired), false otherwise.
   */
  attack(now: number): boolean {
    if (now < this.lastAttack + Agent.ATTACK_COOLDOWN) {
      return false;
    }
    // Update the cooldown timestamp.
    this.lastAttack = now;
    return true;
  }
}

//
// Test Suite for Cooldown Mechanisms using plain TypeScript
//
describe("Cooldown Mechanisms (Simulation)", () => {
  let agent: Agent;

  beforeEach(() => {
    // Create a new agent instance before each test.
    agent = new Agent();
  });

  describe("Ignore Cooldown", () => {
    it("should allow an ignore action if cooldown has expired", () => {
      const now = 1000;
      
      // First ignore call should succeed.
      const firstIgnore = agent.ignore(now);
      assert.isTrue(firstIgnore, "First ignore should succeed");
      
      // Immediately calling ignore again should fail (cooldown not expired).
      const secondIgnore = agent.ignore(now + 100);
      assert.isFalse(secondIgnore, "Ignore call within cooldown should fail");
      
      // After the cooldown period has expired, ignore should succeed.
      const thirdIgnore = agent.ignore(now + Agent.IGNORE_COOLDOWN + 1);
      assert.isTrue(thirdIgnore, "Ignore call after cooldown should succeed");
    });
  });

  describe("Attack Cooldown", () => {
    it("should allow an attack if cooldown has expired", () => {
      const now = 2000;
      
      // First attack should succeed.
      const firstAttack = agent.attack(now);
      assert.isTrue(firstAttack, "First attack should succeed");
      
      // Calling attack within the cooldown period should fail.
      const secondAttack = agent.attack(now + 100);
      assert.isFalse(secondAttack, "Attack call within cooldown should fail");
      
      // After the cooldown period, attack should succeed again.
      const thirdAttack = agent.attack(now + Agent.ATTACK_COOLDOWN + 1);
      assert.isTrue(thirdAttack, "Attack call after cooldown should succeed");
    });
  });
});
