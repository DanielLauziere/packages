import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['ticket-engine/src/**/*.test.ts'],
  },
})
