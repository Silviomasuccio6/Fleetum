// A separate Node test process keeps the real module-level OTP abuse budget
// independent from the adversarial-limit suite. No production guard is reset.
process.env.FLEETUM_TEST_LEGACY_SIGNING="1";
await import("./contract-signing-otp.test.js");
export {};
