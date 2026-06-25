function gridWays(center) {
  const ways = [];
  const spacing = 0.0018;
  let id = 1000;
  for (let row = -3; row <= 3; row += 1) {
    ways.push({
      type: 'way', id: id++,
      tags: { highway: row === 0 ? 'primary' : 'residential', name: row === 0 ? '中央道路' : `東西道路${row}` },
      geometry: Array.from({ length: 7 }, (_, index) => ({
        lat: center.lat + row * spacing,
        lon: center.lon + (index - 3) * spacing
      }))
    });
  }
  for (let column = -3; column <= 3; column += 1) {
    ways.push({
      type: 'way', id: id++,
      tags: { highway: column === 0 ? 'secondary' : 'residential', name: column === 0 ? '中央縦断路' : `南北道路${column}` },
      geometry: Array.from({ length: 7 }, (_, index) => ({
        lat: center.lat + (index - 3) * spacing,
        lon: center.lon + column * spacing
      }))
    });
  }
  return ways;
}

export function createDevelopmentDependencies() {
  const location = { lat: 35.7869, lon: 139.4693, accuracy: 8, timestamp: Date.now() };
  return {
    geolocation: {
      async getCurrentPosition() { return location; },
      watchPosition(onPosition) { onPosition(location); return () => {}; }
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { elements: gridWays(location) }; }
    })
  };
}
