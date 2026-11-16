import type { NagayaApi } from '@shared/api'

declare global {
  interface Window {
    nagaya: NagayaApi
  }
}


export {}
