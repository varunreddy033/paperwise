// Test double for the AI engine, used only for UI development and automated screenshots
// (open the app with ?mock=1). The real app always uses ai.js / Firebase AI Logic.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createMockEngine() {
  return {
    cloudModel: 'mock',
    async deviceStatus() { return 'available'; },
    async prepareDevice(cb) { for (let i = 0; i <= 1; i += 0.25) { cb?.(i); await wait(100); } },
    async readImage() { await wait(400); return { text: 'Mock transcription', source: 'ON_DEVICE', ms: 400 }; },
    async detectEntities(text) {
      await wait(500);
      const m = text.match(/(Flat[^\n]+|H\.No[^,]+, [^,]+, Hyderabad)/);
      return { entities: m ? [{ text: m[1].replace(/ PIN.*/, ''), type: 'ADDRESS' }] : [], source: 'ON_DEVICE', ms: 512 };
    },
    async explain(redacted, language, { deviceOnly }) {
      await wait(800);
      return {
        source: deviceOnly ? 'ON_DEVICE' : 'IN_CLOUD', ms: 1840, language, sentBytes: deviceOnly ? 0 : redacted.length + 1400,
        data: {
          docType: 'Electricity disconnection notice (final)',
          summary: 'Your electricity bill for September and October is unpaid. You owe Rs. 4,862, which includes old dues and a late fee. If you do not pay by 02-12-2026, the power company will cut the electricity at [ADDRESS_1] without any further warning.',
          urgency: 'high',
          urgencyReason: 'Only 7 days left before disconnection.',
          actions: [
            { task: 'Pay Rs. 4,862 for service connection [ID_1] through the official TGSPDCL app or an ERO counter', deadline: '02-12-2026', why: 'Avoids disconnection and the extra Rs. 150 reconnection charge.' },
            { task: 'Keep the payment receipt or screenshot', deadline: 'Same day', why: 'Proof if the notice was sent by mistake.' },
            { task: 'If you already paid, visit the Madhapur ERO with your receipt', deadline: 'Before 02-12-2026' },
          ],
          keyFacts: [
            { label: 'Total due', value: 'Rs. 4,862.00', meaning: 'Includes Rs. 2,310 arrears and Rs. 96 late fee' },
            { label: 'Last date', value: '02-12-2026', meaning: 'Supply can be cut after this date' },
            { label: 'Reconnection charge', value: 'Rs. 150.00', meaning: 'Extra, only if power is cut' },
          ],
          redFlags: ['Pay only through official channels. The notice itself says the department never asks for payment via personal numbers or WhatsApp links.'],
          questions: ['Can I pay the arrears in instalments?', 'Why is there an arrear of Rs. 2,310 from earlier months?'],
          replyDraft: 'Dear Sir/Madam, I am [PERSON_1], holder of service connection [ID_1]. I will pay the dues of Rs. 4,862 before 02-12-2026. Kindly do not disconnect the supply. Contact: [PHONE_1].',
        },
      };
    },
    async ask(redacted, guide, q, language, { deviceOnly }) {
      await wait(600);
      return { text: 'Yes. Paying through the official TGSPDCL app is safe and updates your account [ID_1] immediately. Avoid any links sent on WhatsApp.', source: deviceOnly ? 'ON_DEVICE' : 'IN_CLOUD', ms: 900, sentBytes: deviceOnly ? 0 : 1800 };
    },
  };
}
