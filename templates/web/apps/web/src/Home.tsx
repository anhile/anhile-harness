import type { ReactElement } from 'react';

/**
 * The first page. One heading and one line, so a browser test has something
 * to assert about and a person has something to look at.
 *
 * `ReactElement` rather than `JSX.Element`: React 19 removed the global JSX
 * namespace, and the old annotation no longer compiles.
 */
export function Home(): ReactElement {
  return (
    <main>
      <h1>__PROJECT_NAME__</h1>
      <p>The gate is green and nothing else is built yet.</p>
    </main>
  );
}
