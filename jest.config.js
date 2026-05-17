export default {
  testEnvironment: 'jest-environment-jsdom',
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/unit/**/*.test.js'],
};
