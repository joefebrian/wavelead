// Factory + registry. Selects the active PaymentProvider from environment.
import { PayPalPaymentProvider } from './paypalProvider';
import type { PaymentProvider, PaymentProviderId } from './paymentProvider';

let _instance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_instance) return _instance;
  const which = (process.env.PAYMENT_PROVIDER || 'paypal').toLowerCase();
  if (which === 'paypal') {
    _instance = new PayPalPaymentProvider();
    return _instance;
  }
  // Stripe is PARKED for M06.0. Reintroduce here when reactivated.
  throw new Error(`Payment provider "${which}" is not enabled. Only "paypal" is active in M06.0.`);
}

export function providerIdOf(): PaymentProviderId {
  return getPaymentProvider().id;
}

// Test-only injection point.
export function _setPaymentProviderForTesting(p: PaymentProvider | null) {
  _instance = p;
}
