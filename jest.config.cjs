/** Two projects: the product, and the guards that fire at the harness. */
module.exports = {
  // At the root, not in a project: jest refuses it there. The platform
  // project starts empty, and an empty project must not be a red gate.
  passWithNoTests: true,
  // Every case by name, into the run's 03-unit.log. The spec-auditor reads
  // that log to find the assertion a contract names, and a tally of "514
  // passed" locates nothing: the first audit here could confirm no criterion
  // for that reason alone.
  verbose: true,
  // Explicit, because Jest 30 without it prints neither PASS lines nor case
  // names whatever `verbose` says, and the log above was a tally and stderr.
  reporters: ['default'],
  collectCoverage: true,
  // Into the run's own evidence folder when the gate is driving, so a
  // run's coverage is filed with the rest of what it produced and step 08
  // can find it. Anywhere else and the gate is red for a reason that has
  // nothing to do with the code.
  coverageDirectory: process.env.EVIDENCE_DIR
    ? `${process.env.EVIDENCE_DIR}/coverage`
    : '.generated/coverage',
  coverageReporters: ['json-summary', 'text-summary'],
  collectCoverageFrom: ['packages/*/src/**/*.ts', '!**/*.spec.ts'],
  projects: [
    {
      displayName: 'unit',
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/packages/*/src/**/*.spec.ts'],
      // NodeNext wants the `.js` specifier in source; ts-jest compiles to
      // CommonJS and cannot resolve it. Mapping it back is what lets one
      // set of files satisfy both.
      moduleNameMapper: { '^(\.{1,2}/.*)\.js$': '$1' },
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }] },
    },
    {
      displayName: 'platform',
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/scripts/__tests__/**/*.spec.ts'],
      // Empty until this project writes guards of its own. The harness
      // brings the mechanisms; the assertions about them live with the
      // harness, not in every project that adopts it.
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }] },
    },
  ],
};
