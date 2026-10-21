// Data minimization: what the agent (and the LLM provider behind it) may see of a PayPal order.
// An allowlist of the fields a refund needs; anything else, wherever PayPal adds it, is withheld:
// card details, payer and payee, names, addresses, the shop's custom_id, notes and links.

type Shape = 'scalar' | Shape[] | { [field: string]: Shape };

const MONEY: Shape = { currency_code: 'scalar', value: 'scalar' };
const CAPTURE: Shape = { id: 'scalar', status: 'scalar', amount: MONEY, final_capture: 'scalar', create_time: 'scalar', update_time: 'scalar' };
const REFUND: Shape = { id: 'scalar', status: 'scalar', amount: MONEY, create_time: 'scalar', update_time: 'scalar' };
const ORDER: Shape = {
  id: 'scalar',
  intent: 'scalar',
  status: 'scalar',
  create_time: 'scalar',
  update_time: 'scalar',
  purchase_units: [
    { reference_id: 'scalar', amount: MONEY, description: 'scalar', payments: { captures: [CAPTURE], refunds: [REFUND] } },
  ],
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The kept part of `value`, or undefined when its shape doesn't match, so the caller withholds it whole.
function keep(value: unknown, shape: Shape, path: string, withheld: string[]): unknown {
  if (shape === 'scalar') return ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((item, i) => {
      const kept = keep(item, shape[0], `${path}[${i}]`, withheld);
      if (kept === undefined) withheld.push(`${path}[${i}]`);
      return kept === undefined ? [] : [kept];
    });
  }
  if (!isRecord(value)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [field, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${field}` : field;
    const result = field in shape ? keep(child, shape[field], childPath, withheld) : undefined;
    if (result === undefined) withheld.push(childPath);
    else kept[field] = result;
  }
  return kept;
}

export function minimizeOrder(order: unknown): { order: Record<string, unknown>; withheld: string[] } {
  const withheld: string[] = [];
  const kept = keep(order, ORDER, '', withheld);
  return { order: isRecord(kept) ? kept : {}, withheld };
}
