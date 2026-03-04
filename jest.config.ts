import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@conversation/(.*)$': '<rootDir>/src/conversation/$1',
    '^@pql/(.*)$': '<rootDir>/src/pql/$1',
    '^@revenue/(.*)$': '<rootDir>/src/revenue/$1',
    '^@integration/(.*)$': '<rootDir>/src/integration/$1',
    '^@iam/(.*)$': '<rootDir>/src/iam/$1',
    '^@notifications/(.*)$': '<rootDir>/src/notifications/$1',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 50,
    },
    'src/pql/domain/': {
      lines: 95,
      functions: 100,
      branches: 90,
    },
  },
}

export default config
