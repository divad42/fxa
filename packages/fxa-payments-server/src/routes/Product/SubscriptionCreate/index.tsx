import React, { useState, useCallback, useEffect, Suspense } from 'react';
import { Stripe, StripeCardElement, StripeError } from '@stripe/stripe-js';
import { Plan, Profile, Customer } from '../../../store/types';
import { State as ValidatorState } from '../../../lib/validator';

import { useNonce } from '../../../lib/hooks';
import { getErrorMessage } from '../../../lib/errors';

import PlanDetails from '../../../components/PlanDetails';
import Header from '../../../components/Header';
import PaymentForm, { PaymentFormProps } from '../../../components/PaymentForm';
import ErrorMessage from '../../../components/ErrorMessage';
import AcceptedCards from '../../Product/AcceptedCards';

import * as Amplitude from '../../../lib/amplitude';
import { Localized } from '@fluent/react';
import * as apiClient from '../../../lib/apiClient';

import { config } from '../../../lib/config';

import '../../Product/SubscriptionCreate/index.scss';

type PaymentError = undefined | StripeError;
type RetryStatus = undefined | { invoiceId: string };

export type SubscriptionCreateStripeAPIs = Pick<
  Stripe,
  'createPaymentMethod' | 'confirmCardPayment'
>;

export type SubscriptionCreateAuthServerAPIs = Pick<
  typeof apiClient,
  | 'apiCreateCustomer'
  | 'apiCreateSubscriptionWithPaymentMethod'
  | 'apiRetryInvoice'
  | 'apiDetachFailedPaymentMethod'
>;

export type SubscriptionCreateProps = {
  isMobile: boolean;
  profile: Profile;
  customer: Customer | null;
  selectedPlan: Plan;
  refreshSubscriptions: () => void;
  validatorInitialState?: ValidatorState;
  paymentErrorInitialState?: PaymentError;
  stripeOverride?: SubscriptionCreateStripeAPIs;
  apiClientOverrides?: Partial<SubscriptionCreateAuthServerAPIs>;
};

const PaypalButton = React.lazy(() => import('../../Product/PayPalButton'));

export const SubscriptionCreate = ({
  isMobile,
  profile,
  customer,
  selectedPlan,
  refreshSubscriptions,
  validatorInitialState,
  paymentErrorInitialState,
  stripeOverride,
  apiClientOverrides = {},
}: SubscriptionCreateProps) => {
  const [submitNonce, refreshSubmitNonce] = useNonce();

  useEffect(() => {
    if (!config.featureFlags.usePaypalUIByDefault) {
      return;
    }
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${config.paypal.clientId}&vault=true&commit=false&intent=authorize&disable-funding=credit,card`;
    script.onload = () => {
      setPaypalScriptLoaded(true);
    };
    script.onerror = () => {
      throw new Error('Paypal SDK could not be loaded.');
    };
    document.body.appendChild(script);
  }, []);

  const onFormMounted = useCallback(
    () => Amplitude.createSubscriptionMounted(selectedPlan),
    [selectedPlan]
  );

  const onFormEngaged = useCallback(
    () => Amplitude.createSubscriptionEngaged(selectedPlan),
    [selectedPlan]
  );

  const [paypalScriptLoaded, setPaypalScriptLoaded] = useState(false);

  const [inProgress, setInProgress] = useState(false);

  const [paymentError, setPaymentError] = useState<PaymentError>(
    paymentErrorInitialState
  );
  const [retryStatus, setRetryStatus] = useState<RetryStatus>();

  // clear any error rendered with `ErrorMessage` on form change
  const onChange = useCallback(() => {
    if (paymentError) {
      setPaymentError(undefined);
    }
  }, [paymentError, setPaymentError]);

  const onSubmit: PaymentFormProps['onSubmit'] = useCallback(
    async ({ stripe: stripeFromParams, ...params }) => {
      setInProgress(true);
      try {
        await handleSubscriptionPayment({
          ...params,
          ...apiClient,
          ...apiClientOverrides,
          stripe:
            stripeOverride /* istanbul ignore next - used for testing */ ||
            stripeFromParams,
          selectedPlan,
          customer,
          retryStatus,
          onSuccess: refreshSubscriptions,
          onFailure: setPaymentError,
          onRetry: (status: RetryStatus) => {
            setRetryStatus(status);
            setPaymentError({ type: 'card_error', code: 'card_declined' });
          },
        });
      } catch (error) {
        console.error('handleSubscriptionPayment failed', error);
        setPaymentError(error);
      }
      setInProgress(false);
      refreshSubmitNonce();
    },
    [
      selectedPlan,
      customer,
      retryStatus,
      apiClientOverrides,
      stripeOverride,
      setInProgress,
      refreshSubscriptions,
      refreshSubmitNonce,
      setPaymentError,
      setRetryStatus,
    ]
  );

  return (
    <>
      <Header {...{ profile }} />
      <div className="main-content">
        <div className="product-payment" data-testid="subscription-create">
          <div
            className="subscription-create-heading"
            data-testid="subscription-create-heading"
          >
            <Localized id="product-plan-details-heading">
              <h2>Set up your subscription</h2>
            </Localized>
            <Localized id="sub-guarantee">
              <p className="subheading">30-day money-back guarantee</p>
            </Localized>
          </div>

          <h3 className="billing-title">
            <Localized id="sub-update-title">
              <span className="title">Billing Information</span>
            </Localized>
          </h3>

          {!hasExistingCard(customer) && <AcceptedCards />}

          <ErrorMessage isVisible={!!paymentError}>
            {paymentError && (
              <Localized id={getErrorMessage(paymentError.code || 'UNKNOWN')}>
                <p data-testid="error-payment-submission">
                  {getErrorMessage(paymentError.code || 'UNKNOWN')}
                </p>
              </Localized>
            )}
          </ErrorMessage>

          {paypalScriptLoaded && (
            <Suspense fallback={<div>Loading...</div>}>
              <PaypalButton />
            </Suspense>
          )}

          <PaymentForm
            {...{
              customer,
              submitNonce,
              onSubmit,
              onChange,
              inProgress,
              validatorInitialState,
              confirm: true,
              plan: selectedPlan,
              onMounted: onFormMounted,
              onEngaged: onFormEngaged,
            }}
          />
        </div>
        <PlanDetails
          {...{
            profile,
            selectedPlan,
            isMobile,
            showExpandButton: isMobile,
          }}
        />
        <MobileCreateHeading {...{ isMobile }} />
      </div>
    </>
  );
};

const MobileCreateHeading = ({ isMobile }: { isMobile: boolean }) =>
  isMobile ? (
    <div
      className="mobile-subscription-create-heading"
      data-testid="mobile-subscription-create-heading"
    >
      <div className="subscription-create-heading">
        <Localized id="product-plan-details-heading">
          <h2>Set up your subscription</h2>
        </Localized>
        <Localized id="sub-guarantee">
          <p className="subheading">30-day money-back guarantee</p>
        </Localized>
      </div>
    </div>
  ) : null;

async function handleSubscriptionPayment({
  stripe,
  name,
  card,
  idempotencyKey,
  selectedPlan,
  customer,
  retryStatus,
  apiCreateCustomer,
  apiCreateSubscriptionWithPaymentMethod,
  apiRetryInvoice,
  apiDetachFailedPaymentMethod,
  onFailure,
  onRetry,
  onSuccess,
}: {
  stripe: Pick<Stripe, 'createPaymentMethod' | 'confirmCardPayment'>;
  name: string;
  card: StripeCardElement | null;
  idempotencyKey: string;
  selectedPlan: Plan;
  customer: Customer | null;
  retryStatus: RetryStatus;
  apiDetachFailedPaymentMethod: SubscriptionCreateAuthServerAPIs['apiDetachFailedPaymentMethod'];
  onFailure: (error: PaymentError) => void;
  onRetry: (status: RetryStatus) => void;
  onSuccess: () => void;
} & SubscriptionCreateAuthServerAPIs) {
  // If there's an existing card on record, GOTO 3

  if (hasExistingCard(customer)) {
    const createSubscriptionResult = await apiCreateSubscriptionWithPaymentMethod(
      {
        priceId: selectedPlan.plan_id,
        productId: selectedPlan.product_id,
        idempotencyKey,
      }
    );
    return handlePaymentIntent({
      customer,
      invoiceId: createSubscriptionResult.latest_invoice.id,
      paymentIntentStatus:
        createSubscriptionResult.latest_invoice.payment_intent.status,
      paymentIntentClientSecret:
        createSubscriptionResult.latest_invoice.payment_intent.client_secret,
      paymentMethodId:
        createSubscriptionResult.latest_invoice.payment_intent.payment_method,
      stripe,
      apiDetachFailedPaymentMethod,
      onSuccess,
      onFailure,
      onRetry,
    });
  }

  // 1. Create the payment method.
  const {
    paymentMethod,
    error: paymentError,
  } = await stripe.createPaymentMethod({
    type: 'card',
    card: card as StripeCardElement,
  });
  if (paymentError) {
    return onFailure(paymentError);
  }
  if (!paymentMethod) {
    return onFailure({ type: 'card_error' });
  }

  // 2. Create the customer, if necessary.
  if (!customer) {
    // We look up the customer by UID & email on the server.
    // No need to retain the result of this call for later.
    await apiCreateCustomer({
      displayName: name,
      idempotencyKey,
    });
  }

  const commonPaymentIntentParams = {
    paymentMethodId: paymentMethod.id,
    stripe,
    apiDetachFailedPaymentMethod,
    onSuccess,
    onFailure,
    onRetry,
  };

  if (!retryStatus) {
    // 3a. Attempt to create the subscription.
    const createSubscriptionResult = await apiCreateSubscriptionWithPaymentMethod(
      {
        priceId: selectedPlan.plan_id,
        productId: selectedPlan.product_id,
        paymentMethodId: paymentMethod.id,
        idempotencyKey,
      }
    );
    return handlePaymentIntent({
      customer,
      invoiceId: createSubscriptionResult.latest_invoice.id,
      paymentIntentStatus:
        createSubscriptionResult.latest_invoice.payment_intent.status,
      paymentIntentClientSecret:
        createSubscriptionResult.latest_invoice.payment_intent.client_secret,
      ...commonPaymentIntentParams,
    });
  } else {
    // 3b. Retry payment for the subscription invoice created earlier.
    const { invoiceId } = retryStatus;
    const retryInvoiceResult = await apiRetryInvoice({
      invoiceId: retryStatus.invoiceId,
      paymentMethodId: paymentMethod.id,
      idempotencyKey,
    });
    return handlePaymentIntent({
      customer,
      invoiceId,
      paymentIntentStatus: retryInvoiceResult.payment_intent.status,
      paymentIntentClientSecret:
        retryInvoiceResult.payment_intent.client_secret,
      ...commonPaymentIntentParams,
    });
  }
}

async function handlePaymentIntent({
  customer,
  invoiceId,
  paymentIntentStatus,
  paymentIntentClientSecret,
  paymentMethodId,
  stripe,
  apiDetachFailedPaymentMethod,
  onSuccess,
  onFailure,
  onRetry,
}: {
  customer: Customer | null;
  invoiceId: string;
  paymentIntentStatus: string;
  paymentIntentClientSecret: string | null;
  paymentMethodId: string | undefined;
  stripe: Pick<Stripe, 'confirmCardPayment'>;
  apiDetachFailedPaymentMethod: SubscriptionCreateAuthServerAPIs['apiDetachFailedPaymentMethod'];
  onFailure: (error: PaymentError) => void;
  onRetry: (status: RetryStatus) => void;
  onSuccess: () => void;
}): Promise<void> {
  switch (paymentIntentStatus) {
    case 'succeeded': {
      return onSuccess();
    }
    case 'requires_payment_method': {
      // If this happens when a customer is trying to subscribe to their first
      // product, detach the payment method.  The user must enter a working
      // card to move on; we'll get a working payment method from that.
      // This does not affect functionality, thus not blocking.
      if (
        (!customer || (customer && customer.subscriptions.length === 0)) &&
        paymentMethodId
      ) {
        apiDetachFailedPaymentMethod({ paymentMethodId });
      }
      return onRetry({ invoiceId });
    }
    case 'requires_action': {
      if (!paymentIntentClientSecret) {
        return onFailure({ type: 'api_error' });
      }
      const confirmResult = await stripe.confirmCardPayment(
        paymentIntentClientSecret,
        { payment_method: paymentMethodId }
      );
      if (confirmResult.error) {
        return onFailure(confirmResult.error);
      }
      if (!confirmResult.paymentIntent) {
        return onFailure({ type: 'api_error' });
      }
      return handlePaymentIntent({
        customer,
        invoiceId,
        paymentIntentStatus: confirmResult.paymentIntent.status,
        paymentIntentClientSecret: confirmResult.paymentIntent.client_secret,
        paymentMethodId,
        stripe,
        apiDetachFailedPaymentMethod,
        onSuccess,
        onFailure,
        onRetry,
      });
    }
    // Other payment_intent.status cases?
    default: {
      console.error('Unexpected payment intent status', paymentIntentStatus);
      return onFailure({ type: 'api_error' });
    }
  }
}

const hasExistingCard = (customer: Customer | null) =>
  customer && customer.last4 && customer.subscriptions.length > 0;

export default SubscriptionCreate;
