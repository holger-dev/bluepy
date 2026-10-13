/// <reference types="vite/client" />
import type { BluePyApi } from '@bluepy/protocol'

declare global {
  interface Window {
    bluepy: BluePyApi
  }
}

export {}
