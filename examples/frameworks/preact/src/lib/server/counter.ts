/**
 * One counter for the whole server, in memory: every droplet reads and
 * bumps the same value, through `/api/counter` in the
 * browser and directly in server loads.
 */
let count = 0;

export const readCount = (): number => count;

export const addToCount = (by: number): number => (count += by);
