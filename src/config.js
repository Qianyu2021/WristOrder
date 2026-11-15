import 'dotenv/config';

const env = process.env;
const forcedMock = (flag, key) => env[flag] === '1' || !env[key];

export const config = Object.freeze({
  port: Number(env.PORT || 3000),
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiConversationModel: env.GEMINI_CONVERSATION_MODEL || 'gemini-4-argon',
  deepgramApiKey: env.DEEPGRAM_API_KEY || '',
  deepgramSttModel: env.DEEPGRAM_STT_MODEL || 'nova-3',
  deepgramTtsModel: env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en',
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  resendApiKey: env.RESEND_API_KEY || '',
  reportToEmail: env.REPORT_TO_EMAIL || '',
  reportCron: env.REPORT_CRON || '',
  useMockGemini: forcedMock('MOCK_GEMINI', 'GEMINI_API_KEY'),
  useMockStt: forcedMock('MOCK_STT', 'DEEPGRAM_API_KEY'),
  useMockTts: forcedMock('MOCK_TTS', 'DEEPGRAM_API_KEY'),
  useMockStripe: forcedMock('MOCK_STRIPE', 'STRIPE_SECRET_KEY'),
  useMockEmail: forcedMock('MOCK_EMAIL', 'RESEND_API_KEY'),
});

export const serviceModes = Object.freeze({
  gemini: config.useMockGemini ? 'mock' : 'live',
  stt: config.useMockStt ? 'mock' : 'live',
  tts: config.useMockTts ? 'mock' : 'live',
  stripe: config.useMockStripe ? 'mock' : 'live',
  email: config.useMockEmail ? 'mock' : 'live',
});
