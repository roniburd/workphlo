import type { WorkphloApi } from './index'

declare global {
  interface Window {
    workphlo: WorkphloApi
  }
}

export {}
