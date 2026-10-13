import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'

const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'de'

void i18next.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: browserLanguage.toLowerCase().startsWith('de') ? 'de' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18next
