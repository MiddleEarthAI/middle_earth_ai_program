
/// A placeholder function that returns a constant burn percentage.
/// In a real game, you'd want to integrate an oracle or VRF for randomness.
pub fn random_burn_percentage(min_burn: u64, max_burn: u64) -> u64 {
    // Just returns min_burn for now. This is where you'd do real RNG.
    min_burn
}

/// Another example utility to calculate distance between two coordinates.
pub fn distance(x1: i32, y1: i32, x2: i32, y2: i32) -> f64 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    ((dx.pow(2) + dy.pow(2)) as f64).sqrt()
}
