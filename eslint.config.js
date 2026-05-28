import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  // 1. Base recommended rules
  js.configs.recommended,

  // 2. App-specific rules with browser globals
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Set: 'readonly',
        Map: 'readonly',
        Promise: 'readonly',
        AbortController: 'readonly',
        performance: 'readonly',
        navigator: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        URLSearchParams: 'readonly',
        alert: 'readonly',
        prompt: 'readonly',
        confirm: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        FileReader: 'readonly',
        location: 'readonly',
        WeakMap: 'readonly',
        WeakSet: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        ResizeObserver: 'readonly',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-debugger': 'error',
      'indent': ['warn', 2, { SwitchCase: 1 }],
      'semi': ['warn', 'always'],
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'no-unused-expressions': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },

  // 3. Ignored paths
  {
    ignores: [
      'dist/',
      'deploy/',
      'node_modules/',
      '*.config.js',
      'vite.config.js',
    ],
  },
];

