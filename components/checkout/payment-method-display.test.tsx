import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentMethodDisplay } from "./payment-method-display";

/**
 * Stripe's raw BNPL `payment_method_types` value ("afterpay_clearpay") used to
 * fall through to the unparseable-title branch and render verbatim,
 * capitalized. A friendly label + icon now cover the three BNPL types Stripe
 * can hand back here, whether they arrive as the session's `paymentMethod` or
 * as the `paymentMethodTitle` WooCommerce stored.
 */
describe("PaymentMethodDisplay BNPL labels", () => {
  it("renders Afterpay for the raw afterpay_clearpay title", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay paymentMethodTitle="Afterpay_clearpay" />,
    );
    expect(html).toContain(">Afterpay<");
    expect(html).not.toContain("Afterpay_clearpay");
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("is case-insensitive on the raw type", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay paymentMethodTitle="afterpay_clearpay" />,
    );
    expect(html).toContain(">Afterpay<");
  });

  it("renders Klarna for the raw klarna title", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay paymentMethodTitle="klarna" />,
    );
    expect(html).toContain(">Klarna<");
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("renders Zip for the raw zip title", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay paymentMethodTitle="Zip" />,
    );
    expect(html).toContain(">Zip<");
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("labels the session's own method id when WooCommerce stored no usable title", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay
        paymentMethod="afterpay_clearpay"
        paymentMethodTitle="Pay with card"
      />,
    );
    expect(html).toContain(">Afterpay<");
    expect(html).not.toContain("afterpay_clearpay");
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("still shows the raw title for a genuinely unparseable title", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay paymentMethodTitle="Some Unknown Gateway" />,
    );
    expect(html).toContain("Some Unknown Gateway");
  });

  it("still resolves PayPal by title and by session unaffected by the BNPL branch", () => {
    expect(
      renderToStaticMarkup(
        <PaymentMethodDisplay paymentMethodTitle="PayPal" />,
      ),
    ).toContain(">PayPal<");
    expect(
      renderToStaticMarkup(<PaymentMethodDisplay paymentMethod="paypal" />),
    ).toContain(">PayPal<");
  });

  it("leaves a card payment alone", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodDisplay cardBrand="visa" cardLast4="4242" />,
    );
    expect(html).toContain("End with 4242");
    expect(html).not.toContain("Afterpay");
  });
});
