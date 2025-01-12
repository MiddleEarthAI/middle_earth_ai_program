import { assert } from "chai";

// Define the TerrainType enum (matching your Rust definition)
enum TerrainType {
  Plain = 0,
  Mountain = 1,
  River = 2,
}

// Define cooldown constants (in seconds) as in your Rust code
const MOVE_PLAIN_COOLDOWN = 3600;    // 1 hour in seconds
const MOVE_RIVER_COOLDOWN = 7200;     // 2 hours in seconds
const MOVE_MOUNTAIN_COOLDOWN = 10800; // 3 hours in seconds

/**
 * A simplified Agent class in TypeScript that mimics the relevant logic
 * from your Rust Agent struct.
 */
class Agent {
  public x: number;
  public y: number;
  public last_move: number;
  public next_move_time: number;
  public is_alive: boolean;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.last_move = 0;
    this.next_move_time = 0;
    this.is_alive = true;
  }

  /**
   * Validates if the agent can move at the provided timestamp.
   * Returns true if allowed, false otherwise.
   */
  validate_movement(now: number): boolean {
    if (!this.is_alive) return false;
    return now >= this.next_move_time;
  }

  /**
   * Applies a terrain-based movement cooldown.
   * For Plain: adds 1 hour, River: 2 hours, Mountain: 3 hours.
   */
  apply_terrain_move_cooldown(terrain: TerrainType, now: number): void {
    let cooldown: number;
    switch (terrain) {
      case TerrainType.Plain:
        cooldown = MOVE_PLAIN_COOLDOWN;
        break;
      case TerrainType.River:
        cooldown = MOVE_RIVER_COOLDOWN;
        break;
      case TerrainType.Mountain:
        cooldown = MOVE_MOUNTAIN_COOLDOWN;
        break;
      default:
        cooldown = MOVE_PLAIN_COOLDOWN;
    }
    this.next_move_time = now + cooldown;
  }

  /**
   * Attempts to move the agent. If the cooldown has passed, updates the position
   * and sets the appropriate movement cooldown based on terrain.
   * Returns true if the move succeeded; false otherwise.
   */
  move(newX: number, newY: number, terrain: TerrainType, now: number): boolean {
    if (!this.validate_movement(now)) {
      return false;
    }
    this.x = newX;
    this.y = newY;
    this.last_move = now;
    this.apply_terrain_move_cooldown(terrain, now);
    return true;
  }
}

// -----------------------------
// TypeScript tests using ts-mocha
// -----------------------------

describe("Agent Movement Logic", () => {
  it("should allow movement if cooldown has expired", () => {
    const agent = new Agent(0, 0);
    const now = 1000; // current timestamp in seconds

    // Initially, since next_move_time is 0, movement is allowed.
    assert.isTrue(agent.validate_movement(now), "Movement should be allowed initially");
    // Perform a move with Plain terrain.
    const success = agent.move(10, 20, TerrainType.Plain, now);
    assert.isTrue(success, "Movement should succeed");
    assert.equal(agent.x, 10, "Agent X position should update to 10");
    assert.equal(agent.y, 20, "Agent Y position should update to 20");
    // Expect next_move_time = now + MOVE_PLAIN_COOLDOWN
    assert.equal(agent.next_move_time, now + MOVE_PLAIN_COOLDOWN);
  });

  it("should not allow movement if cooldown has not expired", () => {
    const agent = new Agent(0, 0);
    const now = 1000;
    // Perform an initial move to set a cooldown.
    agent.move(10, 20, TerrainType.Plain, now);
    // Try another move before the cooldown expires.
    const tooEarly = now + 100; // only 100 seconds later
    const success = agent.move(30, 40, TerrainType.Mountain, tooEarly);
    assert.isFalse(success, "Movement should fail due to cooldown");
    // Position should remain unchanged.
    assert.equal(agent.x, 10, "Agent X should remain unchanged");
    assert.equal(agent.y, 20, "Agent Y should remain unchanged");
  });

  it("should set the correct cooldown for each terrain", () => {
    const agent = new Agent(0, 0);
    const now = 2000;
    
    // Test Plain movement:
    agent.move(5, 5, TerrainType.Plain, now);
    assert.equal(agent.next_move_time, now + MOVE_PLAIN_COOLDOWN, "Plain cooldown should be 1 hour");

    // Reset cooldown manually for testing.
    agent.next_move_time = 0;
    agent.move(10, 10, TerrainType.River, now);
    assert.equal(agent.next_move_time, now + MOVE_RIVER_COOLDOWN, "River cooldown should be 2 hours");

    // Reset again and test Mountain movement:
    agent.next_move_time = 0;
    agent.move(20, 20, TerrainType.Mountain, now);
    assert.equal(agent.next_move_time, now + MOVE_MOUNTAIN_COOLDOWN, "Mountain cooldown should be 3 hours");
  });
});
