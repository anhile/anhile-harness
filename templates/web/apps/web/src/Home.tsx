import type { ReactElement } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from './components/ui/card';

/**
 * The first page, composed from the catalog under components/ui and the
 * tokens in index.css: one heading and one card that says what this is.
 * DESIGN.md is the brief every page after this one is held to.
 *
 * `ReactElement` rather than `JSX.Element`: React 19 removed the global JSX
 * namespace, and the old annotation no longer compiles.
 */
export function Home(): ReactElement {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">__PROJECT_NAME__</h1>
        <p className="text-muted">A page held to a brief, from the first screen on.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Nothing to see yet</CardTitle>
          <CardDescription>The gate is green and nothing else is built yet.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
