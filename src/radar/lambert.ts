import type { LambertGrid } from './grib2';

const RAD = Math.PI / 180;

/** Spherical Lambert conformal projection for a GRIB grid. The returned function
 * writes the fractional column and row to `out`; cell centers are whole numbers. */
export function createLambert(grid: LambertGrid): (lat: number, lon: number, out: Float64Array) => void {
  const p1 = grid.latin1 * RAD, p2 = grid.latin2 * RAD;
  const halfTan = (p: number) => Math.tan(Math.PI / 4 + p / 2);
  const n = grid.latin1 === grid.latin2 ? Math.sin(p1) : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(halfTan(p2) / halfTan(p1));
  const scale = grid.radius * Math.cos(p1) * halfTan(p1) ** n / n;

  const delta = (lon: number) => {
    const d = (lon - grid.lov) % 360;
    return d > 180 ? d - 360 : d < -180 ? d + 360 : d;
  };
  const planeX = (lat: number, lon: number) => scale / halfTan(lat * RAD) ** n * Math.sin(n * delta(lon) * RAD);
  const planeY = (lat: number, lon: number) => -scale / halfTan(lat * RAD) ** n * Math.cos(n * delta(lon) * RAD);
  const x0 = planeX(grid.lat1, grid.lon1), y0 = planeY(grid.lat1, grid.lon1);

  return (lat, lon, out) => {
    const rho = scale / halfTan(lat * RAD) ** n, theta = n * delta(lon) * RAD;
    out[0] = (rho * Math.sin(theta) - x0) / grid.dx;
    out[1] = (-rho * Math.cos(theta) - y0) / grid.dy;
  };
}
