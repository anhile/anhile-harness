/**
 * The first guarantee, so the gate has something to verify on its first run.
 * Replace it with the real one; keep the shape — a function, and a test that
 * would fail if the function were wrong.
 */
export function greet(name: string): string {
  if (name.trim() === '') throw new Error('greet needs a name');
  return `Hello, ${name}.`;
}
