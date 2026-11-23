// Fill these in from the Firebase console (Project settings > Your apps > Web app).
// These values are not secrets: Firebase web config is meant to ship to the browser.
// Access is protected by App Check (reCAPTCHA Enterprise in production, debug token on localhost).

export const FIREBASE_VERSION = '13.4.0';

export const CONFIG = {
  firebase: {
    apiKey: 'AIzaSyCRukvTD6oXD-IlGSSFq1pRkkdIHRaWI-M',
    authDomain: 'paperwise-e1219.firebaseapp.com',
    projectId: 'paperwise-e1219',
    storageBucket: 'paperwise-e1219.firebasestorage.app',
    messagingSenderId: '521333188021',
    appId: '1:521333188021:web:ecc1f4cb45a8e9c58765fc',
  },
  // Security > App Check > your web app. 'enterprise' (recommended) or 'v3'.
  recaptchaProvider: 'enterprise',
  recaptchaSiteKey: '6LcCtC4uAAAAAPREcrg_-ngM4LzUE9OfAJd3d25n',
  // Leave as null: on localhost a debug token is printed in the console; register it in App Check > Manage debug tokens.
  appCheckDebugToken: null,
  // Default cloud model; can be overridden live with the Remote Config parameter `cloud_model`.
  defaultCloudModel: 'gemini-3.5-flash-lite',
  // Tried in order if the default model is overloaded or unavailable.
  fallbackCloudModels: ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
};
