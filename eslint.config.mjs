import tseslint from 'typescript-eslint';

// The layer rules go here. This one only asks that the code compiles under
// the recommended set; a project adds its own boundaries and a suite that
// fires at them, which is the third part of every guard.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-types/**', '**/node_modules/**', '.generated/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The copied guard suites use `_name` for arguments they must accept
      // and will not read. Without this the gate is red on its first run,
      // on files the generator itself wrote.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
