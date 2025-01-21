import matplotlib.pyplot as plt

def generate_circular_square_map(size):
    radius = size // 2
    center = (radius, radius)
    coordinates = set()

    for x in range(size):
        for y in range(size):
            dx = abs(x - center[0])
            dy = abs(y - center[1])
            
            # Manhattan distance
            manhattan_distance = dx + dy
            # Euclidean distance
            euclidean_distance = (dx**2 + dy**2) ** 0.5
            
            weight = 0.6
            effective_distance = weight * manhattan_distance + (1 - weight) * euclidean_distance
            
            # Use an integer comparison for including a tile
            if int(effective_distance) <= radius + 3:
                coordinates.add((x , y ))  # Shift coordinates by 0.5 units
    
    return coordinates

def visualize_coordinates(coordinates, size):
    # Create a grid filled with zeros.
    grid = [[0 for _ in range(size)] for _ in range(size)]
    for x, y in coordinates:
        # Convert shifted coordinates back to integers for grid indexing.
        grid[int(y)][int(x)] = 1

    plt.figure(figsize=(8, 8))
    plt.imshow(grid, cmap="Greys", origin="lower", extent=[0, size, 0, size])  # No additional shift needed here.
    
    plt.xticks(range(size + 1))
    plt.yticks(range(size + 1))

    plt.xlabel("X-axis")
    plt.ylabel("Y-axis")
    plt.title("Square Map with Circular Edges (Shifted by 0.5 units)")
    plt.show()

# Example usage:
map_size = 29
coordinates = generate_circular_square_map(map_size)
print(coordinates)
visualize_coordinates(coordinates, map_size)
