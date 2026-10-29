// Demo sales agent: an LLM that talks with the customer who writes to the shop and sells them
// catalogue products with one PayPal order they pay on PayPal. It runs the support agent's loop
// (./support-agent.ts) with its own prompts, so it too only ever reaches PayPal through the payment
// guard's tools. It creates orders; the shop's server captures them when the buyer comes back
// (lib/shop/checkout.ts), so the agent never takes a payment.

import { checkoutUrls } from '@/lib/shop/checkout';
import { SHOP_CATALOGUE, type ShopCatalogue } from '@/lib/shop/catalogue';
import { runSupportAgent, type AgentPrompts, type AgentStep, type SupportTicket } from './support-agent';

// The customer is whoever writes; the message is what they wrote, untrusted.
export type SalesChat = SupportTicket;

const price = (minor: number) => `${(minor / 100).toFixed(2)} ${SHOP_CATALOGUE.currency}`;

// The catalogue as the agent reads it, from the same data the guard checks against.
const catalogueText = (catalogue: ShopCatalogue) => catalogue.items.map((item) => `- ${item.name}: ${price(item.priceMinor)}`).join('\n');

const systemPrompt = (shopOrigin: string) => (instructions: string) => {
  const { returnUrl, cancelUrl } = checkoutUrls(shopOrigin);
  return `You are the sales agent of a small online shop. You talk with the customer who writes to you and sell them products from the shop's catalogue with a PayPal order, which they pay on PayPal.
The catalogue, unit prices in USD:
${catalogueText(SHOP_CATALOGUE)}
An order may carry at most ${SHOP_CATALOGUE.maxQuantityPerItem} of a product. There is no tax and shipping is free.
When the customer has chosen, call create_order once with currencyCode "USD", "shippingCost": 0, and one item per product: {"name": the product's name exactly as in the catalogue, "quantity": a whole number, "itemCost": its catalogue price, "taxPercent": 0, "itemTotal": itemCost × quantity}, i.e. taxPercent 0 and shippingCost 0. Add a discount only when the shop's instructions below state a promotion. Always pass "returnUrl": "${returnUrl}" and "cancelUrl": "${cancelUrl}".
Create one order per conversation, only for the customer who writes, and never for anyone else.
create_order answers with the new order and its links: give the customer the link whose rel is "payer-action" (or "approve") so they can approve and pay on PayPal. The shop takes the payment when they come back; never take the payment yourself.
If the payment guard blocks or holds a call, don't try another way: tell the customer plainly what was blocked or held and why.
${instructions}
When you are done, answer the customer in one short paragraph.`;
};

const userPrompt = ({ customerEmail, message }: SalesChat) => `Message from the customer ${customerEmail}:\n\n${message}`;

// The agent's prompts for a shop at `shopOrigin`, the origin its return links must use.
export const salesPrompts = (shopOrigin: string): AgentPrompts => ({ system: systemPrompt(shopOrigin), user: userPrompt });

type LoopOptions = Omit<Parameters<typeof runSupportAgent>[0], 'ticket' | 'prompts'>;

export function runSalesAgent({ task, shopOrigin, ...options }: LoopOptions & { task: SalesChat; shopOrigin: string }): Promise<{ reply: string; steps: AgentStep[] }> {
  return runSupportAgent({ ...options, ticket: task, prompts: salesPrompts(shopOrigin) });
}
