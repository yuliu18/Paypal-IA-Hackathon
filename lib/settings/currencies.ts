// The currencies PayPal's REST APIs accept (developer.paypal.com/reference/currency-codes), for
// the limits' currency. HUF, JPY and TWD take no decimals there, so their limits are whole amounts.
// Amounts are still kept in hundredths, as the guard reads every PayPal amount (lib/guard).

export type Currency = { code: string; name: string; decimals: 0 | 2 };

const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);

export const CURRENCIES: Currency[] = (
  [
    ['AUD', 'Australian Dollar'],
    ['BRL', 'Brazilian Real'],
    ['CAD', 'Canadian Dollar'],
    ['CNY', 'Chinese Renminbi'],
    ['CZK', 'Czech Koruna'],
    ['DKK', 'Danish Krone'],
    ['EUR', 'Euro'],
    ['HKD', 'Hong Kong Dollar'],
    ['HUF', 'Hungarian Forint'],
    ['ILS', 'Israeli New Shekel'],
    ['JPY', 'Japanese Yen'],
    ['MYR', 'Malaysian Ringgit'],
    ['MXN', 'Mexican Peso'],
    ['TWD', 'New Taiwan Dollar'],
    ['NZD', 'New Zealand Dollar'],
    ['NOK', 'Norwegian Krone'],
    ['PHP', 'Philippine Peso'],
    ['PLN', 'Polish Złoty'],
    ['GBP', 'Pound Sterling'],
    ['SGD', 'Singapore Dollar'],
    ['SEK', 'Swedish Krona'],
    ['CHF', 'Swiss Franc'],
    ['THB', 'Thai Baht'],
    ['USD', 'United States Dollar'],
  ] as const
).map(([code, name]) => ({ code, name, decimals: ZERO_DECIMAL.has(code) ? 0 : 2 }));

export const currencyFor = (code: string) => CURRENCIES.find((c) => c.code === code);
